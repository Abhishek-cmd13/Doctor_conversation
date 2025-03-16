// Copy this file as config.js and add your API keys
const config = {
    // API Keys
    sarvamApiKey: 'your_sarvam_api_key',
    geminiApiKey: 'your_gemini_api_key',
    deepgramApiKey: 'your_deepgram_api_key',
    airtableApiKey: 'your_airtable_api_key',
    airtableBaseId: 'your_airtable_base_id',

    // Element IDs
    recordButtonId: 'recordButton',
    stopButtonId: 'stopButton',
    submitButtonId: 'submitButton',
    transcriptId: 'transcript',
    recordingStatusId: 'recordingStatus',
    errorMessageId: 'errorMessage',
    patientNameId: 'patientName',
    symptomsId: 'symptoms',
    medicalHistoryId: 'medicalHistory',
    medicationsId: 'medications',
    medicalSummaryId: 'medicalSummary',
    timestampId: 'timestamp',

    isConfigValid() {
        return !!(
            this.sarvamApiKey &&
            this.geminiApiKey &&
            this.deepgramApiKey &&
            this.airtableApiKey &&
            this.airtableBaseId
        );
    }
}; 