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
        this.recordButton.addEventListener('click', async () => {
            const permissionState = await this.checkMicrophonePermissions();
            if (permissionState === 'denied') {
                this.showDetailedError(
                    'Permission Required',
                    'Microphone access is blocked. Please update your browser settings to allow microphone access.'
                );
                return;
            }
            this.startRecording();
        });
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
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 44100,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/mp4',
                audioBitsPerSecond: 128000
            });

            this.audioChunks = [];
            this.updateProgress(25, 'Recording');

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/mp4' });
                await this.transcribeAudio(audioBlob);
            };

            this.mediaRecorder.start();
            console.log('Recording started with iOS settings');

        } catch (error) {
            console.error('Recording Setup Error:', {
                message: error.message,
                timestamp: new Date().toISOString(),
                deviceInfo: this.getDeviceInfo()
            });
            this.showError('Microphone access failed. Please check permissions.');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    }

    async transcribeAudio(audioBlob) {
        try {
            this.updateProgress(50, 'Transcribing');
            const transcript = await this.transcribeWithDeepgram(audioBlob);
            
            if (transcript) {
                this.updateProgress(75, 'Processing');
                await this.processWithGemini(transcript);
                this.updateProgress(100, 'Complete');
                setTimeout(() => this.hideProgress(), 1000);
            }
        } catch (error) {
            console.error('Transcription Error:', {
                error: error.message,
                timestamp: new Date().toISOString(),
                deviceInfo: this.getDeviceInfo()
            });
            this.hideProgress();
            this.showError('Transcription failed. Please try again.');
        }
    }

    async transcribeWithDeepgram(audioBlob) {
        try {
            console.log('Starting Deepgram transcription:', {
                blobSize: audioBlob.size,
                blobType: audioBlob.type,
                timestamp: new Date().toISOString()
            });

            const formData = new FormData();
            formData.append('audio', audioBlob);

            const response = await fetch('https://api.deepgram.com/v1/listen?' + new URLSearchParams({
                model: 'nova-2',
                language: 'en-US',
                encoding: 'linear16',
                sample_rate: 44100,
                punctuate: true
            }), {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${config.deepgramApiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Deepgram API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
                throw new Error('No transcript in response');
            }

            const transcript = data.results.channels[0].alternatives[0].transcript;
            
            if (transcript.trim()) {
                this.transcriptElement.value = transcript;
                console.log('Transcription successful:', {
                    length: transcript.length,
                    preview: transcript.substring(0, 50) + '...'
                });
                return transcript;
            } else {
                throw new Error('Empty transcript received');
            }

        } catch (error) {
            console.error('Deepgram Error:', {
                error: error.message,
                stack: error.stack,
                deviceInfo: this.getDeviceInfo(),
                audioInfo: {
                    size: audioBlob.size,
                    type: audioBlob.type
                }
            });
            throw new Error(`Transcription failed: ${error.message}`);
        }
    }

    async processWithGemini(transcript) {
        try {
            this.updateProgress(75, 'Processing');
            const prompt = `Extract the medical information stated by the patient and provide ALL responses in English, regardless of the input language.

Transcript to analyze: "${transcript}"

Return the response in this exact JSON format:
{
    "patientName": "Name in English if mentioned, otherwise 'Not provided'",
    "symptoms": "Current symptoms in English, exactly as translated from patient's statement",
    "medicalHistory": "Past medical conditions in English, exactly as translated from patient's statement",
    "medications": "Current medications in English with dosages as stated",
    "medicalSummary": "Brief list of main complaints in English"
}

Important:
- Translate all information to English
- Include ONLY what patient explicitly states
- Keep medical terms in English
- Do not add interpretations or recommendations
- Ignore casual conversation
- Keep responses brief and to the point
- If something is not mentioned, write "Not mentioned"`;

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
            this.updateProgress(100, 'Complete');
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

        // Format phone number for WhatsApp
        const formattedPhone = `91${phoneNumber.replace(/\D/g, '')}`;
        
        // Create WhatsApp URL
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const whatsappUrl = isIOS ? 
            `whatsapp://send?phone=${formattedPhone}&text=${encodeURIComponent(message)}` :
            `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
        
        // Simply open WhatsApp without error checking
        window.location.href = whatsappUrl;
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
        const errorInfo = {
            title,
            details,
            timestamp: new Date().toISOString(),
            deviceInfo: {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
                language: navigator.language,
                onLine: navigator.onLine
            }
        };

        console.error('Error Information:', errorInfo);

        // Create and show error modal
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
                                <pre class="error-log">${details}</pre>
                            </div>
                            <div class="device-info mb-3">
                                <h6>Technical Information:</h6>
                                <ul class="list-unstyled">
                                    <li>Browser: ${navigator.userAgent}</li>
                                    <li>Online Status: ${navigator.onLine ? 'Connected' : 'Offline'}</li>
                                    <li>Time: ${new Date().toLocaleString()}</li>
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

        // Remove existing modal if present
        const existingModal = document.getElementById('errorModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to document
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Show the modal
        const errorModal = new bootstrap.Modal(document.getElementById('errorModal'));
        errorModal.show();
    }

    // Add a method to check permissions before starting
    async checkMicrophonePermissions() {
        try {
            const result = await navigator.permissions.query({ name: 'microphone' });
            return result.state;
        } catch (error) {
            console.error('Error checking permissions:', error);
            return 'unknown';
        }
    }

    // Add this helper method to verify transcript
    verifyTranscript(transcript) {
        if (!transcript || typeof transcript !== 'string') {
            console.error('Invalid transcript type:', typeof transcript);
            return false;
        }
        if (transcript.trim().length === 0) {
            console.error('Empty transcript');
            return false;
        }
        return true;
    }

    // Add this helper method for iOS logging
    logIOSDetails() {
        return {
            deviceInfo: {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                vendor: navigator.vendor,
                memory: navigator.deviceMemory,
                screen: {
                    width: window.screen.width,
                    height: window.screen.height,
                    pixelRatio: window.devicePixelRatio
                }
            },
            browser: {
                language: navigator.language,
                languages: navigator.languages,
                cookieEnabled: navigator.cookieEnabled,
                onLine: navigator.onLine
            },
            timestamp: new Date().toISOString()
        };
    }

    // Add this helper method to get device information
    getDeviceInfo() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            vendor: navigator.vendor,
            screen: {
                width: window.screen.width,
                height: window.screen.height,
                ratio: window.devicePixelRatio
            }
        };
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioTranscriptionApp();
}); 