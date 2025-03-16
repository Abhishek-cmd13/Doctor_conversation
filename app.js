            this.mediaRecorder.start();
            this.isRecording = true;

            // Update UI
            this.recordButton.textContent = 'Stop Recording';
            this.recordButton.classList.add('recording');
            
            console.log(`Recording started on ${isIOS ? 'iOS' : 'non-iOS'} device`);

        } catch (error) {
            console.error('Recording error:', {
                error: error.message,
                isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
                userAgent: navigator.userAgent
            });
            alert('Microphone access failed. Please check permissions.');
            this.resetRecordingState();
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
        } catch (error) {
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
        } catch (error) {
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
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioTranscriptionApp();
}); 