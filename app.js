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
        
        // Load cached phone number on startup
        this.loadCachedPhoneNumber();
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
        this.doctorPhoneElement = document.getElementById(config.doctorPhoneId);
        this.clearPhoneBtn = document.getElementById('clearPhoneBtn');
        
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

        // Add phone number validation and auto-save
        if (this.doctorPhoneElement) {
            this.doctorPhoneElement.addEventListener('input', (e) => {
                // Remove any non-numeric characters
                e.target.value = e.target.value.replace(/\D/g, '');
                
                // Limit to 10 digits
                if (e.target.value.length > 10) {
                    e.target.value = e.target.value.slice(0, 10);
                }

                // Save to localStorage when a valid number is entered
                if (e.target.value.length === 10) {
                    this.savePhoneNumber(e.target.value);
                }
            });
        }

        if (this.clearPhoneBtn) {
            this.clearPhoneBtn.addEventListener('click', () => {
                this.clearSavedPhoneNumber();
            });
        }

        this.progressCard = document.getElementById(config.progressCardId);
        this.progressBar = document.getElementById(config.progressBarId);
        this.progressStatus = document.getElementById(config.progressStatusId);
        this.progressPercentage = document.getElementById(config.progressPercentageId);
        this.progressStage = document.getElementById(config.progressStageId);
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
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            
            // Configure audio constraints
            const audioConstraints = {
                audio: {
                    channelCount: 1,
                    sampleRate: isIOS ? 44100 : 16000, // iOS typically uses 44.1kHz
                    sampleSize: 16,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };

            this.stream = await navigator.mediaDevices.getUserMedia(audioConstraints);

            // Use a format that works on iOS
            const options = {
                mimeType: isIOS ? 'audio/mp4' : 'audio/webm;codecs=opus',
                audioBitsPerSecond: 128000
            };

            try {
                this.mediaRecorder = new MediaRecorder(this.stream, options);
            } catch (e) {
                // Fallback if the preferred format isn't supported
                this.mediaRecorder = new MediaRecorder(this.stream);
            }

            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { 
                    type: this.mediaRecorder.mimeType 
                });
                await this.transcribeAudio(audioBlob);
            };

            // Set a smaller timeslice for more frequent ondataavailable events
            this.mediaRecorder.start(1000); // 1 second chunks
            this.isRecording = true;
            this.updateUIForRecording(true);
            this.updateProgress(25, 'Recording', 'Capturing your voice...');
            
        } catch (error) {
            console.error('Recording Error:', error);
            this.showError(`Recording failed: ${error.message}`);
            this.hideProgress();
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
            this.updateProgress(50, 'Transcribing', 'Converting speech to text...');
            console.log('Audio blob type:', audioBlob.type); // Debug log
            console.log('Audio blob size:', audioBlob.size); // Debug log

            // Create a copy of the blob with a supported mime type if needed
            let processedBlob = audioBlob;
            if (!audioBlob.type.includes('audio/')) {
                processedBlob = new Blob([audioBlob], { type: 'audio/mp4' });
            }

            if (this.selectedLanguage === 'kn') {
                await this.transcribeWithSarvam(processedBlob, this.selectedLanguage);
            } else {
                await this.transcribeWithDeepgram(processedBlob, this.selectedLanguage);
            }
            this.updateProgress(75, 'Processing', 'Analyzing with AI...');
        } catch (error) {
            this.hideProgress();
            console.error('Transcription Error:', error);
            this.showError(`Transcription failed: ${error.message}`);
        }
    }

    async transcribeWithDeepgram(audioBlob, language) {
        try {
            // Collect debug information
            const debugInfo = {
                blobType: audioBlob.type,
                blobSize: audioBlob.size,
                isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
                language: language,
                timestamp: new Date().toISOString()
            };

            console.log('Debug Info:', debugInfo);

            const isIOS = debugInfo.isIOS;
            let finalBlob = audioBlob;

            if (isIOS) {
                try {
                    // Convert to WAV format for consistency
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    const wavBlob = await this.audioBufferToWav(audioBuffer);
                    finalBlob = new Blob([wavBlob], { type: 'audio/wav' });
                    
                    debugInfo.conversionSuccess = true;
                    debugInfo.convertedType = finalBlob.type;
                    debugInfo.convertedSize = finalBlob.size;
                } catch (conversionError) {
                    debugInfo.conversionSuccess = false;
                    debugInfo.conversionError = conversionError.message;
                    this.showDetailedError(
                        'Audio Conversion Error',
                        JSON.stringify(debugInfo, null, 2)
                    );
                    finalBlob = audioBlob;
                }
            }

            const formData = new FormData();
            formData.append('audio', finalBlob);

            const params = new URLSearchParams({
                model: 'nova-2',
                language: language,
                punctuate: true,
                diarize: false,
                channels: 1,
                encoding: isIOS ? 'linear16' : 'opus',
                sample_rate: isIOS ? 44100 : 16000
            });

            debugInfo.requestParams = Object.fromEntries(params);

            const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${config.deepgramApiKey}`,
                    'Content-Type': isIOS ? 'audio/wav' : audioBlob.type
                },
                body: formData
            });

            debugInfo.responseStatus = response.status;
            debugInfo.responseStatusText = response.statusText;

            if (!response.ok) {
                const errorData = await response.json();
                debugInfo.errorResponse = errorData;
                this.showDetailedError(
                    'Transcription Failed',
                    JSON.stringify(debugInfo, null, 2)
                );
                throw new Error(errorData.message || `Deepgram error: ${response.status}`);
            }

            const data = await response.json();
            debugInfo.transcriptionSuccess = true;

            if (!data.results || !data.results.channels || !data.results.channels[0].alternatives) {
                debugInfo.invalidResponse = true;
                this.showDetailedError(
                    'Invalid Response Format',
                    JSON.stringify(debugInfo, null, 2)
                );
                throw new Error('Invalid response format from Deepgram');
            }

            const transcript = data.results.channels[0].alternatives[0].transcript;
            this.transcriptElement.value = transcript;
            await this.processWithGemini(transcript);

        } catch (error) {
            console.error('Deepgram API Error:', error);
            this.showDetailedError(
                'Transcription Error',
                JSON.stringify({
                    error: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString(),
                    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
                    userAgent: navigator.userAgent
                }, null, 2)
            );
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
            this.updateProgress(75, 'Processing', 'Analyzing with AI...');
            const prompt = `As a medical documentation assistant, analyze this clinical conversation transcript and extract detailed medical information. This is being used in a healthcare setting, so pay special attention to medical terminology, lab values, and clinical findings.

Please analyze and structure the following information with high attention to medical accuracy:

1. Patient Information:
   - Full name (if mentioned)
   - Age and gender (if mentioned)
   - Any demographic details provided

2. Chief Complaints and Symptoms:
   - Primary complaints
   - Associated symptoms
   - Onset, duration, and severity
   - Aggravating/alleviating factors
   - Pattern and progression of symptoms

3. Medical History:
   - Past medical conditions
   - Surgical history
   - Family history of diseases
   - Current medical conditions
   - Allergies and reactions
   - Previous hospitalizations
   - Immunization status

4. Medications:
   - Current medications with dosages
   - Recent medication changes
   - Over-the-counter medications
   - Supplements and herbal remedies
   - Medication allergies
   - Medication compliance

5. Clinical Assessment:
   - Vital signs if mentioned
   - Physical examination findings
   - Lab test results and values
   - Imaging or diagnostic test results
   - Differential diagnoses discussed
   - Treatment plan modifications

Medical Summary:
Create a comprehensive yet concise summary that includes:
- Key clinical findings
- Primary concerns
- Treatment decisions
- Follow-up plans
- Critical medical instructions
- Any urgent care instructions
- Referrals or specialist consultations

Transcript to analyze: "${transcript}"

Return the response in this exact JSON format:
{
    "patientName": "Full name or 'Not provided'",
    "symptoms": "Detailed list of symptoms with characteristics",
    "medicalHistory": "Comprehensive medical history including conditions, surgeries, and family history",
    "medications": "Complete medication list with dosages and recent changes",
    "medicalSummary": "Detailed clinical summary with key findings and plan"
}

Important notes:
1. Maintain medical terminology where used
2. Include numerical values for lab results exactly as stated
3. Preserve dosage information precisely
4. Note any critical or abnormal findings
5. Highlight any urgent follow-up requirements
6. If information is not mentioned, state 'Not discussed in conversation'
7. Flag any concerning symptoms or values that require immediate attention`;

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
                        temperature: 0.3, // Lower temperature for more precise, clinical responses
                        topP: 0.8,
                        topK: 40
                    }
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
                this.symptomsElement.value = this.formatMedicalText(result.symptoms);
                this.medicalHistoryElement.value = this.formatMedicalText(result.medicalHistory);
                this.medicationsElement.value = this.formatMedicalText(result.medications);
                this.medicalSummaryElement.value = this.formatMedicalText(result.medicalSummary);
                
                // Set timestamp
                const now = new Date();
                this.timestampElement.value = now.toLocaleString();
            } catch (parseError) {
                console.error('Raw response:', resultText);
                throw new Error('Failed to parse Gemini AI response as JSON');
            }
            
            // After successful processing and form filling
            this.updateProgress(100, 'Complete', 'Form filled successfully!');
            setTimeout(() => {
                this.hideProgress();
            }, 1000);
        } catch (error) {
            this.hideProgress();
            this.showError('Error processing with Gemini AI: ' + error.message);
        }
    }

    // Helper method to format medical text with proper line breaks and bullet points
    formatMedicalText(text) {
        if (!text) return 'Not mentioned';
        
        // Convert dash lists to bullet points
        text = text.replace(/^- /gm, '• ');
        
        // Ensure proper spacing between sections
        text = text.replace(/\n{3,}/g, '\n\n');
        
        return text;
    }

    updateUIForRecording(isRecording) {
        this.recordButton.disabled = isRecording;
        this.stopButton.disabled = !isRecording;
        this.recordingStatus.style.display = isRecording ? 'block' : 'none';
    }

    async submitToAirtable() {
        try {
            this.updateProgress(90, 'Saving', 'Submitting to database...');
            this.submitButton.disabled = true;
            this.submitButton.innerHTML = '<i class="bi bi-hourglass-split"></i> Submitting...';

            // First submit to Airtable
            const airtableData = {
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
                body: JSON.stringify(airtableData)
            });

            if (!response.ok) {
                throw new Error('Failed to submit to Airtable');
            }

            // After successful Airtable submission, open WhatsApp
            this.sendWhatsApp();
            
            this.showSuccess('Successfully submitted to Airtable and opening WhatsApp!');
            
            // Reset the form
            this.resetForm();
            this.updateProgress(100, 'Complete', 'Opening WhatsApp...');
            setTimeout(() => {
                this.hideProgress();
            }, 1000);
        } catch (error) {
            this.hideProgress();
            console.error('Submission Error:', error);
            this.showError('Error during submission: ' + error.message);
        } finally {
            this.submitButton.disabled = false;
            this.submitButton.innerHTML = '<i class="bi bi-check-circle"></i> Submit to Airtable';
        }
    }

    sendWhatsApp() {
        const phoneNumber = document.getElementById(config.doctorPhoneId).value;
        if (!phoneNumber || phoneNumber.length !== 10) {
            this.showError('Please enter a valid 10-digit phone number');
            return;
        }

        // Save the phone number when sending
        this.savePhoneNumber(phoneNumber);

        const message = `
*Medical Report for ${this.patientNameElement.value}*

*Symptoms:*
${this.symptomsElement.value}

*Medical History:*
${this.medicalHistoryElement.value}

*Medications:*
${this.medicationsElement.value}

*Medical Summary:*
${this.medicalSummaryElement.value}

*Timestamp:* ${this.timestampElement.value}
        `;

        // Format phone number for WhatsApp (add country code and remove spaces/special chars)
        const formattedPhone = `91${phoneNumber.replace(/\D/g, '')}`;
        
        // Create WhatsApp URL with encoded message
        const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
        
        // Open WhatsApp in a new tab
        window.open(whatsappUrl, '_blank');
    }

    resetForm() {
        this.transcriptElement.value = '';
        this.patientNameElement.value = '';
        this.symptomsElement.value = '';
        this.medicalHistoryElement.value = '';
        this.medicationsElement.value = '';
        this.medicalSummaryElement.value = '';
        this.timestampElement.value = '';
        // Don't reset the phone number since we want to keep it
        this.hideProgress();
    }

    showSuccess(message, duration = 5000) {
        const successMessage = document.createElement('div');
        successMessage.className = 'alert alert-success position-fixed bottom-0 end-0 m-3';
        successMessage.textContent = message;
        document.body.appendChild(successMessage);
        setTimeout(() => {
            successMessage.remove();
        }, duration);
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

    loadCachedPhoneNumber() {
        const cachedPhone = localStorage.getItem('doctorPhoneNumber');
        if (cachedPhone && this.doctorPhoneElement) {
            this.doctorPhoneElement.value = cachedPhone;
        }
    }

    savePhoneNumber(phoneNumber) {
        if (phoneNumber && phoneNumber.length === 10) {
            localStorage.setItem('doctorPhoneNumber', phoneNumber);
            this.showSuccess('Phone number saved!', 1000); // Show for 1 second
        }
    }

    clearSavedPhoneNumber() {
        localStorage.removeItem('doctorPhoneNumber');
        if (this.doctorPhoneElement) {
            this.doctorPhoneElement.value = '';
        }
        this.showSuccess('Saved phone number cleared', 1000);
    }

    updateProgress(percentage, status, stage) {
        if (this.progressCard) this.progressCard.style.display = 'block';
        if (this.progressBar) this.progressBar.style.width = `${percentage}%`;
        if (this.progressStatus) this.progressStatus.textContent = status;
        if (this.progressPercentage) this.progressPercentage.textContent = `${percentage}%`;
        if (this.progressStage) this.progressStage.textContent = stage;
    }

    hideProgress() {
        if (this.progressCard) {
            this.progressCard.style.display = 'none';
        }
    }

    // Add this new method to show detailed errors
    showDetailedError(title, details) {
        // Remove any existing error modal
        const existingModal = document.getElementById('errorModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal HTML
        const modalHTML = `
            <div class="modal fade" id="errorModal" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header bg-danger text-white">
                            <h5 class="modal-title">
                                <i class="bi bi-exclamation-triangle-fill me-2"></i>${title}
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="error-details mb-3">
                                <h6 class="text-danger">Error Details:</h6>
                                <pre class="error-log">${details}</pre>
                            </div>
                            <div class="device-info mb-3">
                                <h6>Device Information:</h6>
                                <ul class="list-unstyled">
                                    <li><strong>Device:</strong> ${/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'iOS Device' : 'Other Device'}</li>
                                    <li><strong>Browser:</strong> ${navigator.userAgent}</li>
                                </ul>
                            </div>
                            <div class="troubleshooting-tips">
                                <h6>Troubleshooting Tips:</h6>
                                <ul>
                                    <li>Ensure microphone permissions are granted</li>
                                    <li>Try refreshing the page</li>
                                    <li>Check your internet connection</li>
                                    <li>Try using a different browser</li>
                                </ul>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            <button type="button" class="btn btn-primary" onclick="location.reload()">
                                <i class="bi bi-arrow-clockwise me-2"></i>Refresh Page
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to document
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Add styles for error log
        const style = document.createElement('style');
        style.textContent = `
            .error-log {
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: 4px;
                padding: 10px;
                font-size: 12px;
                white-space: pre-wrap;
                word-wrap: break-word;
                color: #dc3545;
                max-height: 150px;
                overflow-y: auto;
            }
        `;
        document.head.appendChild(style);

        // Show the modal
        const errorModal = new bootstrap.Modal(document.getElementById('errorModal'));
        errorModal.show();
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioTranscriptionApp();
}); 