class AudioTranscriptionApp {
    constructor() {
        if (!config.deepgramApiKey || config.deepgramApiKey === 'YOUR_DEEPGRAM_API_KEY') {
            this.showError('Please set your Deepgram API key in config.js');
            return;
        }
        if (!config.geminiApiKey || config.geminiApiKey === 'YOUR_GEMINI_API_KEY') {
            this.showError('Please set your Gemini API key in config.js');
            return;
        }
        if (!config.airtableApiKey || !config.airtableBaseId) {
            this.showError('Please set your Airtable API key and Base ID in config.js');
            return;
        }

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        this.recordButton = document.getElementById(config.recordButtonId);
        this.stopButton = document.getElementById(config.stopButtonId);
        this.submitButton = document.getElementById(config.submitButtonId);
        this.transcriptElement = document.getElementById(config.transcriptId);
        this.recordingStatus = document.getElementById(config.recordingStatusId);
        this.errorMessage = document.getElementById(config.errorMessageId);
        // Initialize new elements
        this.patientNameElement = document.getElementById(config.patientNameId);
        this.symptomsElement = document.getElementById(config.symptomsId);
        this.medicalHistoryElement = document.getElementById(config.medicalHistoryId);
        this.medicationsElement = document.getElementById(config.medicationsId);
        this.medicalSummaryElement = document.getElementById(config.medicalSummaryId);
        this.timestampElement = document.getElementById(config.timestampId);
    }

    attachEventListeners() {
        this.recordButton.addEventListener('click', () => this.startRecording());
        this.stopButton.addEventListener('click', () => this.stopRecording());
        this.submitButton.addEventListener('click', () => this.submitToAirtable());
    }

    async startRecording() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    sampleSize: 16,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });
            
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                await this.transcribeAudio(audioBlob);
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.updateUIForRecording(true);
        } catch (error) {
            this.showError('Error accessing microphone: ' + error.message);
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.updateUIForRecording(false);
            this.stream.getTracks().forEach(track => track.stop());
        }
    }

    async transcribeAudio(audioBlob) {
        try {
            // Create FormData and append the audio blob
            const formData = new FormData();
            formData.append('audio', audioBlob);

            // Prepare the request with Nova-3 model
            const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=hi', {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${config.deepgramApiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Transcription failed');
            }

            const data = await response.json();
            const transcript = data.results.channels[0].alternatives[0].transcript;
            this.transcriptElement.value = transcript;
            
            // Process the transcript with Gemini AI
            await this.processWithGemini(transcript);
        } catch (error) {
            this.showError('Transcription Error: ' + error.message);
        }
    }

    async processWithGemini(transcript) {
        try {
            const prompt = `Please analyze this medical conversation transcript and extract the following information in a structured format:
            Patient Name (if mentioned)
            Symptoms (list all symptoms mentioned)
            Medical History (any relevant medical history)
            Medications (any medications mentioned)
            Medical Summary (a concise summary of the conversation)

            Transcript: "${transcript}"

            Please format the response as a JSON object with these exact keys:
            {
                "patientName": "",
                "symptoms": "",
                "medicalHistory": "",
                "medications": "",
                "medicalSummary": ""
            }

            Important: Return ONLY the JSON object, without any markdown formatting or additional text.`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                })
            });

            if (!response.ok) {
                throw new Error('Failed to process with Gemini AI');
            }

            const data = await response.json();
            let resultText = data.candidates[0].content.parts[0].text;
            
            // Clean up the response text to ensure it's valid JSON
            resultText = resultText.replace(/```json\s*/, '').replace(/```\s*$/, '').trim();
            
            try {
                const result = JSON.parse(resultText);
                
                // Update the UI with the structured data
                this.patientNameElement.value = result.patientName || 'Not mentioned';
                this.symptomsElement.value = result.symptoms || 'No symptoms mentioned';
                this.medicalHistoryElement.value = result.medicalHistory || 'No medical history mentioned';
                this.medicationsElement.value = result.medications || 'No medications mentioned';
                this.medicalSummaryElement.value = result.medicalSummary || 'No summary available';
                
                // Set timestamp
                const now = new Date();
                this.timestampElement.value = now.toLocaleString();
            } catch (parseError) {
                console.error('Raw response:', resultText);
                throw new Error('Failed to parse Gemini AI response as JSON');
            }
        } catch (error) {
            this.showError('Error processing with Gemini AI: ' + error.message);
        }
    }

    updateUIForRecording(isRecording) {
        this.recordButton.disabled = isRecording;
        this.stopButton.disabled = !isRecording;
        this.recordingStatus.style.display = isRecording ? 'block' : 'none';
    }

    async submitToAirtable() {
        try {
            this.submitButton.disabled = true;
            this.submitButton.innerHTML = '<i class="bi bi-hourglass-split"></i> Submitting...';

            const data = {
                records: [{
                    fields: {
                        'Doctor Name': 'Saurabh',
                        'Patient Name': this.patientNameElement.value,
                        'Symptoms': this.symptomsElement.value,
                        'Medical History': this.medicalHistoryElement.value,
                        'Medications': this.medicationsElement.value,
                        'Medical Summary': this.medicalSummaryElement.value
                    }
                }]
            };

            const response = await fetch(`https://api.airtable.com/v0/${config.airtableBaseId}/Table%201`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.airtableApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'Failed to submit to Airtable');
            }

            const result = await response.json();
            this.showSuccess('Successfully submitted to Airtable!');
            
            // Reset the form
            this.transcriptElement.value = '';
            this.patientNameElement.value = '';
            this.symptomsElement.value = '';
            this.medicalHistoryElement.value = '';
            this.medicationsElement.value = '';
            this.medicalSummaryElement.value = '';
            this.timestampElement.value = '';
        } catch (error) {
            console.error('Airtable Error:', error);
            this.showError('Error submitting to Airtable: ' + error.message);
        } finally {
            this.submitButton.disabled = false;
            this.submitButton.innerHTML = '<i class="bi bi-check-circle"></i> Submit to Airtable';
        }
    }

    showSuccess(message) {
        const successMessage = document.createElement('div');
        successMessage.className = 'alert alert-success position-fixed bottom-0 end-0 m-3';
        successMessage.textContent = message;
        document.body.appendChild(successMessage);
        setTimeout(() => {
            successMessage.remove();
        }, 5000);
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.style.display = 'block';
        setTimeout(() => {
            this.errorMessage.style.display = 'none';
        }, 5000);
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioTranscriptionApp();
}); 