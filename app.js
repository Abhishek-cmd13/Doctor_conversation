class AudioTranscriptionApp {
    constructor() {
        // Check if configuration exists
        if (typeof config === 'undefined') {
            this.showError('Configuration not found. Please ensure config.js is properly set up.');
            return;
        }

        // Validate API keys
        if (!config.isConfigValid()) {
            this.showError('Missing required API keys. Please check your configuration.');
            return;
        }

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        this.selectedLanguage = 'en'; // Default language
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
        this.languageButtons = document.querySelectorAll('.language-btn');
        
        // Set default active button
        this.languageButtons.forEach(button => {
            if (button.dataset.language === this.selectedLanguage) {
                button.classList.add('active');
            }
        });

        // Verify critical elements exist
        if (!this.errorMessage) {
            console.error('Error message element not found');
            // Create error message element if it doesn't exist
            this.errorMessage = document.createElement('div');
            this.errorMessage.id = config.errorMessageId;
            this.errorMessage.className = 'alert alert-danger position-fixed bottom-0 end-0 m-3';
            this.errorMessage.style.display = 'none';
            document.body.appendChild(this.errorMessage);
        }
    }

    attachEventListeners() {
        this.recordButton.addEventListener('click', () => this.startRecording());
        this.stopButton.addEventListener('click', () => this.stopRecording());
        this.submitButton.addEventListener('click', () => this.submitToAirtable());
        
        // Add language button event listeners
        this.languageButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Remove active class from all buttons
                this.languageButtons.forEach(btn => btn.classList.remove('active'));
                // Add active class to clicked button
                button.classList.add('active');
                this.selectedLanguage = button.dataset.language;
                
                // Disable recording if in progress
                if (this.isRecording) {
                    this.stopRecording();
                }
            });
        });
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

            // Use default WebM format for recording
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { 
                    type: 'audio/webm;codecs=opus' 
                });
                await this.transcribeAudio(audioBlob);
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.updateUIForRecording(true);
            
            console.log('Recording started with mime type:', this.mediaRecorder.mimeType);
        } catch (error) {
            console.error('Recording Error:', error);
            this.showError(`Recording failed: ${error.message}`);
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
            console.log('Audio blob type:', audioBlob.type); // Debug log
            console.log('Audio blob size:', audioBlob.size); // Debug log

            if (this.selectedLanguage === 'kn') {
                // Check if we need to convert the audio format
                if (audioBlob.type !== 'audio/wav') {
                    console.log('Audio needs conversion to WAV format'); // Debug log
                    // Here you might need to add audio format conversion
                }
                await this.transcribeWithSarvam(audioBlob, this.selectedLanguage);
            } else {
                await this.transcribeWithDeepgram(audioBlob, this.selectedLanguage);
            }
        } catch (error) {
            console.error('Transcription Error:', error);
            this.showError(`Transcription failed: ${error.message}`);
        }
    }

    async transcribeWithDeepgram(audioBlob, language) {
        try {
            // Create FormData and append the audio blob
            const formData = new FormData();
            formData.append('audio', audioBlob);

            // Prepare the request with Nova-2 model
            const response = await fetch(`https://api.deepgram.com/v1/listen?model=nova-2&language=${language}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${config.deepgramApiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Deepgram transcription failed');
            }

            const data = await response.json();
            const transcript = data.results.channels[0].alternatives[0].transcript;
            this.transcriptElement.value = transcript;
            
            // Process with Gemini after successful transcription
            await this.processWithGemini(transcript);
        } catch (error) {
            console.error('Deepgram API Error:', error);
            throw error;
        }
    }

    async isWavFormat(blob) {
        const array = await blob.arrayBuffer();
        const view = new Uint8Array(array, 0, 12);
        const header = String.fromCharCode(...view);
        return header.includes('WAVE');
    }

    async convertToWav(audioBlob) {
        try {
            // Convert Blob to ArrayBuffer
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Decode the audio data
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // Convert to WAV format
            const wavData = this.audioBufferToWav(audioBuffer);
            
            // Create new blob with WAV format
            return new Blob([wavData], { type: 'audio/wav' });
        } catch (error) {
            console.error('Error converting audio:', error);
            throw error;
        }
    }

    audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;
        
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        
        const dataLength = buffer.length * blockAlign;
        const bufferLength = 44 + dataLength;
        
        const arrayBuffer = new ArrayBuffer(bufferLength);
        const view = new DataView(arrayBuffer);
        
        // WAV header
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);
        
        // Write audio data
        const offset = 44;
        const channelData = [];
        for (let i = 0; i < numChannels; i++) {
            channelData[i] = buffer.getChannelData(i);
        }
        
        let pos = 44;
        for (let i = 0; i < buffer.length; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
                const int = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(pos, int, true);
                pos += 2;
            }
        }
        
        return arrayBuffer;
    }

    async transcribeWithSarvam(audioBlob, language) {
        try {
            console.log('Original audio blob type:', audioBlob.type);
            
            // Convert to WAV if not already WAV
            if (!audioBlob.type.includes('wav')) {
                console.log('Converting audio to WAV format...');
                audioBlob = await this.convertToWav(audioBlob);
                console.log('Converted audio blob type:', audioBlob.type);
            }

            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.wav');
            formData.append('model', 'saarika:v1');
            formData.append('language_code', 'kn-IN');
            formData.append('with_timestamps', 'false');

            console.log('Sending request to Sarvam API...');

            const response = await fetch('https://api.sarvam.ai/speech-to-text', {
                method: 'POST',
                headers: {
                    'api-subscription-key': config.sarvamApiKey,
                },
                body: formData
            });

            console.log('Response status:', response.status); // Debug log

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Sarvam API Error Response:', errorText); // Debug log
                throw new Error(`Sarvam API Error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log('Sarvam API Response:', data); // Debug log

            if (!data || (!data.text && !data.transcript)) {
                throw new Error('Invalid response format from Sarvam API');
            }

            // Use data.transcript instead of data.text
            const transcript = data.transcript || data.text;
            this.transcriptElement.value = transcript;
            
            // Process with Gemini after successful transcription
            await this.processWithGemini(transcript);
            
            return transcript;
        } catch (error) {
            console.error('Detailed Sarvam API Error:', error); // Debug log
            this.showError(`Sarvam Transcription Error: ${error.message}`);
            throw error;
        }
    }

    async processWithGemini(transcript) {
        try {
            const prompt = `Extract ONLY the essential medical information from this conversation. Ignore greetings, casual talk, and any non-medical discussion.

Transcript: "${transcript}"

Return a JSON with these fields:
{
    "patientName": "only the patient's name, nothing else. If not clear, write 'Not mentioned'",
    
    "symptoms": "• list only physical/mental symptoms mentioned\\n• no casual conversation\\n• exactly as described by patient",
    
    "medicalHistory": "• only past medical conditions\\n• only surgeries\\n• only previous health issues\\n• no general conversation",
    
    "medications": "• only medicine names and dosages\\n• only current or prescribed medications\\n• no discussions about medications",
    
    "medicalSummary": "2-3 bullet points maximum:\\n• main health issue\\n• key findings\\n• decided action/treatment"
}

STRICT RULES:
1. ONLY include medical information
2. Ignore all casual conversation
3. If information isn't clearly stated about a field, write "Not mentioned"
4. For medical summary, maximum 3 bullet points
5. Use patient's exact words for symptoms
6. No interpretation or additional medical terms
7. No small talk or conversation details
8. Keep everything brief and focused`;

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
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        topP: 0.3, // More focused responses
                        topK: 10   // Very limited word choice
                    }
                })
            });

            if (!response.ok) {
                throw new Error('Failed to process with Gemini AI');
            }

            const data = await response.json();
            let resultText = data.candidates[0].content.parts[0].text;
            
            // Clean up the response text
            resultText = resultText.replace(/```json\s*/, '').replace(/```\s*$/, '').trim();
            
            try {
                const result = JSON.parse(resultText);
                
                // Format and update UI
                this.patientNameElement.value = result.patientName || 'Not mentioned';
                this.symptomsElement.value = this.formatBulletPoints(result.symptoms);
                this.medicalHistoryElement.value = this.formatBulletPoints(result.medicalHistory);
                this.medicationsElement.value = this.formatBulletPoints(result.medications);
                this.medicalSummaryElement.value = this.formatBulletPoints(result.medicalSummary);
                
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

    // Updated helper method to ensure cleaner bullet points
    formatBulletPoints(text) {
        if (!text || text === 'Not mentioned') return 'Not mentioned';
        
        // Clean up the text first
        let cleanText = text
            .replace(/[•-]\s*Not mentioned/gi, 'Not mentioned')
            .replace(/^Not mentioned$/gi, 'Not mentioned');
        
        if (cleanText === 'Not mentioned') return cleanText;
        
        // Split by newlines or commas and clean up
        const points = cleanText
            .split(/[\n,]/)
            .map(line => line.trim())
            .filter(line => {
                // Remove empty lines and standalone bullet points
                return line.length > 0 && 
                       line !== '•' && 
                       !line.match(/^[•-]\s*$/);
            })
            .map(line => {
                // Clean up and standardize bullet points
                line = line.replace(/^[•-]\s*/, '').trim();
                return line.length > 0 ? `• ${line}` : null;
            })
            .filter(line => line !== null);
        
        return points.length > 0 ? points.join('\n') : 'Not mentioned';
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
        if (this.errorMessage) {
            this.errorMessage.textContent = message;
            this.errorMessage.style.display = 'block';
            setTimeout(() => {
                this.errorMessage.style.display = 'none';
            }, 5000);
        } else {
            console.error('Error:', message);
        }
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioTranscriptionApp();
}); 