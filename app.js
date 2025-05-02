class AudioTranscriptionApp {
    constructor() {
        if (typeof config === 'undefined') {
            this.showError('Configuration not found. Please ensure config.js is properly set up.');
            return;
        }

        if (!config.isConfigValid()) {
            this.showError('Missing required API keys. Please check your configuration.');
            return;
        }

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        this.selectedLanguage = 'en';
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        this.initializeElements();
        this.attachEventListeners();
        this.loadCachedPhoneNumber();
    }

    initializeElements() {
        this.recordButton = document.getElementById(config.recordButtonId);
        this.stopButton = document.getElementById(config.stopButtonId);
        this.submitButton = document.getElementById(config.submitButtonId);
        this.transcriptElement = document.getElementById(config.transcriptId);
        this.recordingStatus = document.getElementById(config.recordingStatusId);
        this.errorMessage = document.getElementById(config.errorMessageId);
        this.languageButtons = document.querySelectorAll('.language-btn');
        this.doctorPhoneElement = document.getElementById(config.doctorPhoneId);
        this.clearPhoneBtn = document.getElementById('clearPhoneBtn');

        // Set initial active language button
        this.languageButtons.forEach(button => {
            if (button.dataset.language === this.selectedLanguage) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
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
                // Update selected language
                this.selectedLanguage = button.dataset.language;
                console.log('Language changed to:', this.selectedLanguage);
            });
        });

        // Add clear phone button event listener
        if (this.clearPhoneBtn) {
            this.clearPhoneBtn.addEventListener('click', () => {
                this.doctorPhoneElement.value = '';
                localStorage.removeItem('doctorPhone');
            });
        }
    }

    loadCachedPhoneNumber() {
        if (this.doctorPhoneElement) {
            const cachedPhone = localStorage.getItem('doctorPhone');
            if (cachedPhone) {
                this.doctorPhoneElement.value = cachedPhone;
            }
            
            // Save phone number when it changes
            this.doctorPhoneElement.addEventListener('change', () => {
                localStorage.setItem('doctorPhone', this.doctorPhoneElement.value);
            });
        }
    }

    async startRecording() {
        try {
            // Safari-specific audio constraints
            const audioConstraints = this.isSafari ? {
                audio: {
                    sampleRate: 44100,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            } : {
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    sampleSize: 16,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            };

            this.stream = await navigator.mediaDevices.getUserMedia(audioConstraints);

            // Safari uses different MIME types
            let mimeType;
            if (this.isSafari) {
                // Try different Safari-compatible MIME types
                const safariMimeTypes = [
                    'audio/mp4',
                    'audio/aac',
                    'audio/wav'
                ];
                
                for (const type of safariMimeTypes) {
                    if (MediaRecorder.isTypeSupported(type)) {
                        mimeType = type;
                        break;
                    }
                }
                
                if (!mimeType) {
                    throw new Error('No supported audio format found for Safari');
                }
            } else {
                mimeType = 'audio/webm;codecs=opus';
            }

            console.log('Using MIME type:', mimeType);

            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                
                // For Safari, we might need to convert the audio format
                if (this.isSafari && !mimeType.includes('wav')) {
                    try {
                        const convertedBlob = await this.convertToWav(audioBlob);
                        await this.transcribeAudio(convertedBlob);
                    } catch (error) {
                        console.error('Audio conversion error:', error);
                        this.showError('Failed to process audio. Please try again.');
                    }
                } else {
                    await this.transcribeAudio(audioBlob);
                }
            };

            // Safari requires smaller timeslices for data collection
            const timeslice = this.isSafari ? 100 : 1000;
            this.mediaRecorder.start(timeslice);
            this.isRecording = true;
            this.updateUIForRecording(true);
            
            console.log('Recording started with mime type:', this.mediaRecorder.mimeType);
        } catch (error) {
            console.error('Recording Error:', error);
            this.showError(`Recording failed: ${error.message}`);
        }
    }

    async convertToWav(audioBlob) {
        try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // Create WAV file
            const wavBlob = await this.audioBufferToWav(audioBuffer);
            return new Blob([wavBlob], { type: 'audio/wav' });
        } catch (error) {
            console.error('WAV conversion error:', error);
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
        
        const wav = new ArrayBuffer(44 + buffer.length * blockAlign);
        const view = new DataView(wav);
        
        // Write WAV header
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + buffer.length * blockAlign, true);
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
        view.setUint32(40, buffer.length * blockAlign, true);
        
        // Write audio data
        const offset = 44;
        const data = new Float32Array(buffer.length);
        const channelData = buffer.getChannelData(0);
        
        for (let i = 0; i < buffer.length; i++) {
            const sample = Math.max(-1, Math.min(1, channelData[i]));
            data[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        
        for (let i = 0; i < data.length; i++) {
            view.setInt16(offset + i * 2, data[i], true);
        }
        
        return wav;
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
            console.log('Audio blob type:', audioBlob.type);
            console.log('Audio blob size:', audioBlob.size);
            
            // Use Sarvam for Kannada, Tamil, and Telugu, Deepgram for other languages
            if (this.selectedLanguage === 'kn' || this.selectedLanguage === 'ta' || this.selectedLanguage === 'te') {
                // Convert language code to Sarvam format (add -IN suffix)
                const sarvamLanguageCode = `${this.selectedLanguage}-IN`;
                await this.transcribeWithSarvam(audioBlob, sarvamLanguageCode);
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
            const formData = new FormData();
            formData.append('audio', audioBlob);

            // Adjust parameters for Safari
            const params = new URLSearchParams({
                model: 'nova-2',
                language: language,
                punctuate: 'true',
                diarize: 'false'
            });

            if (this.isSafari) {
                params.append('encoding', 'linear16');
                params.append('sample_rate', '44100');
            }

            const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
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

    async transcribeWithSarvam(audioBlob, language) {
        try {
            // Convert audio to WAV format for Sarvam API
            const wavBlob = await this.convertToWav(audioBlob);
            
            // Split into 20-second chunks for Kannada, Tamil, and Telugu
            if (language === 'kn-IN' || language === 'ta-IN' || language === 'te-IN') {
                const chunks = await this.splitAudioIntoChunks(wavBlob, 20);
                let fullTranscript = '';
                
                for (let i = 0; i < chunks.length; i++) {
                    console.log(`Processing chunk ${i + 1} of ${chunks.length} for ${language}`);
                    const chunkTranscript = await this.processSarvamChunk(chunks[i], language);
                    fullTranscript += chunkTranscript + ' ';
                }
                
                this.transcriptElement.value = fullTranscript.trim();
                // Process with Gemini after successful transcription
                await this.processWithGemini(fullTranscript.trim());
            } else {
                // For other languages, process normally
                const transcript = await this.processSarvamChunk(wavBlob, language);
                this.transcriptElement.value = transcript;
                // Process with Gemini after successful transcription
                await this.processWithGemini(transcript);
            }
        } catch (error) {
            console.error('Sarvam API Error:', error);
            throw error;
        }
    }

    async splitAudioIntoChunks(audioBlob, chunkDurationSeconds) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            const sampleRate = audioBuffer.sampleRate;
            const chunkSize = sampleRate * chunkDurationSeconds;
            const chunks = [];
            
            for (let i = 0; i < audioBuffer.length; i += chunkSize) {
                const chunkLength = Math.min(chunkSize, audioBuffer.length - i);
                const chunkBuffer = audioContext.createBuffer(
                    audioBuffer.numberOfChannels,
                    chunkLength,
                    sampleRate
                );
                
                // Copy data for each channel
                for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
                    const channelData = audioBuffer.getChannelData(channel);
                    const chunkData = chunkBuffer.getChannelData(channel);
                    for (let j = 0; j < chunkLength; j++) {
                        chunkData[j] = channelData[i + j];
                    }
                }
                
                // Convert chunk to WAV
                const wavBlob = await this.audioBufferToWav(chunkBuffer);
                chunks.push(new Blob([wavBlob], { type: 'audio/wav' }));
            }
            
            return chunks;
        } catch (error) {
            console.error('Error splitting audio:', error);
            throw error;
        }
    }

    async processSarvamChunk(audioBlob, language) {
        const form = new FormData();
        form.append("model", "saarika:v2");
        form.append("language_code", language);
        form.append("with_timestamps", "false");
        form.append("with_diarization", "false");
        form.append("num_speakers", "2");
        form.append("file", audioBlob);

        const response = await fetch('https://api.sarvam.ai/speech-to-text', {
            method: 'POST',
            headers: {
                'api-subscription-key': config.sarvamApiKey,
                'Accept': 'application/json'
            },
            body: form
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Sarvam API Error Response:', errorData);
            throw new Error(errorData.error?.message || 'Sarvam transcription failed');
        }

        const data = await response.json();
        console.log('Sarvam API Response:', data);
        return data.transcript;
    }

    async processWithGemini(transcript) {
        try {
            console.log('Processing transcript with Gemini...');
            
            // Verify API key exists
            if (!config.geminiApiKey) {
                throw new Error('Gemini API key is not configured');
            }

            // Safari-specific fetch options
            const fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Origin': window.location.origin
                },
                mode: 'cors',
                credentials: 'omit',
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Extract the following information from this medical conversation. Format the response exactly as shown below, using simple bullet points (-) for lists. Make sure to include ALL items mentioned, not just one:

Patient Name: [extract patient's name]
Symptoms:
- [list ALL current symptoms and complaints mentioned by both patient and doctor]
Medical History:
- [list ALL past and current medical conditions, including:
  * Chronic diseases (like asthma, diabetes, hypertension)
  * Serious conditions (like cancer, heart disease)
  * Past surgeries
  * Family medical history
  * Any other relevant medical history]
Medications:
- [list ALL medications with their complete dosage information, for example:
  * "Paracetamol 500mg twice daily"
  * "Amoxicillin 250mg three times a day"
  * Include frequency (once/twice/thrice daily), duration, and any special instructions]
Medical Summary: [provide a concise summary]
Lab Tests:
- [list ALL recommended lab tests]

Important: 
- Do not limit yourself to just one item per category. Include EVERYTHING mentioned in the conversation.
- Make sure to categorize chronic and serious diseases (like asthma, cancer, diabetes) under Medical History, not under Symptoms.
- Current symptoms and complaints go under Symptoms, while ongoing/chronic conditions go under Medical History.
- For medications, ALWAYS include the dosage, frequency, and duration if mentioned in the conversation.

Conversation: ${transcript}`
                        }]
                    }]
                })
            };

            // Safari-specific fetch handling
            let response;
            try {
                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`, fetchOptions);
            } catch (fetchError) {
                console.error('Fetch error:', fetchError);
                // Try alternative fetch for Safari
                if (this.isSafari) {
                    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`, {
                        ...fetchOptions,
                        headers: {
                            ...fetchOptions.headers,
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                } else {
                    throw fetchError;
                }
            }

            if (!response.ok) {
                const errorData = await response.json();
                console.error('Gemini API Error Response:', errorData);
                throw new Error(errorData.error?.message || `Failed to process with Gemini: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log('Gemini response:', data);
            
            if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
                throw new Error('Invalid response format from Gemini');
            }

            const analysis = data.candidates[0].content.parts[0].text;
            this.updateFormFields(analysis);
        } catch (error) {
            console.error('Gemini processing error:', error);
            this.showError('Failed to process transcript with Gemini: ' + error.message);
        }
    }

    updateFormFields(analysis) {
        try {
            // Extract information from the analysis and update form fields
            // Using [\s\S]*? to match any characters including newlines until the next section
            const patientNameMatch = analysis.match(/Patient Name:?\s*([^\n]+)/i);
            const symptomsMatch = analysis.match(/Symptoms:?\s*([\s\S]*?)(?=Medical History:|$)/i);
            const medicalHistoryMatch = analysis.match(/Medical History:?\s*([\s\S]*?)(?=Medications:|$)/i);
            const medicationsMatch = analysis.match(/Medications:?\s*([\s\S]*?)(?=Medical Summary:|$)/i);
            const medicalSummaryMatch = analysis.match(/Medical Summary:?\s*([\s\S]*?)(?=Lab Tests:|$)/i);
            const labTestsMatch = analysis.match(/Lab Tests:?\s*([\s\S]*?)(?=\n\n|$)/i);

            if (patientNameMatch) document.getElementById('patientName').value = patientNameMatch[1].trim();
            
            // Clean up bullet points and extra whitespace for multi-line fields
            if (symptomsMatch) {
                const symptoms = symptomsMatch[1]
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.startsWith('-'))
                    .map(line => line.substring(1).trim())
                    .join('\n');
                document.getElementById('symptoms').value = symptoms;
            }
            
            if (medicalHistoryMatch) {
                const history = medicalHistoryMatch[1]
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.startsWith('-'))
                    .map(line => line.substring(1).trim())
                    .join('\n');
                document.getElementById('medicalHistory').value = history;
            }
            
            if (medicationsMatch) {
                const medications = medicationsMatch[1]
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.startsWith('-'))
                    .map(line => line.substring(1).trim())
                    .join('\n');
                document.getElementById('medications').value = medications;
            }
            
            if (medicalSummaryMatch) document.getElementById('medicalSummary').value = medicalSummaryMatch[1].trim();
            
            if (labTestsMatch) {
                const labTests = labTestsMatch[1]
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.startsWith('-'))
                    .map(line => line.substring(1).trim())
                    .join('\n');
                document.getElementById('labTests').value = labTests;
            }

            // Update timestamp
            document.getElementById('timestamp').value = new Date().toLocaleString();
        } catch (error) {
            console.error('Error updating form fields:', error);
            this.showError('Failed to update form fields with analysis');
        }
    }

    updateUIForRecording(isRecording) {
        this.recordButton.disabled = isRecording;
        this.stopButton.disabled = !isRecording;
        this.recordingStatus.style.display = isRecording ? 'block' : 'none';
    }

    async submitToAirtable() {
        try {
            // Get all form values
            const patientName = document.getElementById('patientName').value;
            const symptoms = document.getElementById('symptoms').value;
            const medicalHistory = document.getElementById('medicalHistory').value;
            const medications = document.getElementById('medications').value;
            const medicalSummary = document.getElementById('medicalSummary').value;
            const labTests = document.getElementById('labTests').value;

            // Create fields object with proper Airtable field names
            const fields = {
                "Doctor Name": "Saurabh",
                "Patient Name": patientName || "",
                "Symptoms": symptoms || "",
                "Medical History": medicalHistory || "",
                "Medications": medications || "",
                "Medical Summary": medicalSummary || "",
                "Lab Tests": labTests || ""
            };

            // Safari-specific fetch options
            const fetchOptions = {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.airtableApiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Origin': window.location.origin
                },
                mode: 'cors',
                credentials: 'omit',
                body: JSON.stringify({
                    records: [{
                        fields: fields
                    }]
                })
            };

            // Safari-specific fetch handling
            let response;
            try {
                response = await fetch(`https://api.airtable.com/v0/${config.airtableBaseId}/Table%201`, fetchOptions);
                
                if (!response.ok) {
                    const errorData = await response.json();
                    console.error('Airtable API Error:', errorData);
                    throw new Error(errorData.error?.message || `Failed to submit to Airtable: ${response.status} ${response.statusText}`);
                }
            } catch (fetchError) {
                console.error('Fetch error:', fetchError);
                // Try alternative fetch for Safari
                if (this.isSafari) {
                    response = await fetch(`https://api.airtable.com/v0/${config.airtableBaseId}/Table%201`, {
                        ...fetchOptions,
                        headers: {
                            ...fetchOptions.headers,
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error?.message || `Failed to submit to Airtable: ${response.status} ${response.statusText}`);
                    }
                } else {
                    throw fetchError;
                }
            }

            // Send WhatsApp message if phone number exists
            const doctorPhone = document.getElementById('doctorPhone').value;
            if (doctorPhone) {
                // Create a formatted medical report without asterisks
                const medicalReport = `Medical Report for ${patientName}\n\n` +
                    `Symptoms:\n${symptoms}\n\n` +
                    `Medical History:\n${medicalHistory}\n\n` +
                    `Medications:\n${medications}\n\n` +
                    `Medical Summary:\n${medicalSummary}\n\n` +
                    `Recommended Lab Tests:\n${labTests}\n\n` +
                    `Generated on: ${new Date().toLocaleString()}`;
                
                const encodedMessage = encodeURIComponent(medicalReport);
                if (this.isSafari) {
                    // Try to open WhatsApp app first
                    const whatsappUrl = `whatsapp://send?phone=91${doctorPhone}&text=${encodedMessage}`;
                    const webWhatsappUrl = `https://web.whatsapp.com/send?phone=91${doctorPhone}&text=${encodedMessage}`;
                    
                    // Try to open WhatsApp app
                    window.location.href = whatsappUrl;
                    
                    // After a short delay, check if WhatsApp app was opened
                    setTimeout(() => {
                        // If still on the same page, open WhatsApp Web
                        window.location.href = webWhatsappUrl;
                    }, 1000);
                } else {
                    // For non-Safari browsers, use the regular wa.me link
                    window.open(`https://wa.me/91${doctorPhone}?text=${encodedMessage}`, '_blank');
                }
            }

            // Clear form and show success
            document.getElementById('patientName').value = '';
            document.getElementById('symptoms').value = '';
            document.getElementById('medicalHistory').value = '';
            document.getElementById('medications').value = '';
            document.getElementById('medicalSummary').value = '';
            document.getElementById('labTests').value = '';
            this.transcriptElement.value = '';
            
            this.showSuccess('Data submitted successfully and sent to WhatsApp!');
        } catch (error) {
            console.error('Submission Error:', error);
            this.showError(error.message);
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
