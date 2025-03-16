// Configuration management
const config = {
    // Replace these with your actual API keys
    sarvamApiKey: '473a2b5a-d77a-4721-a745-8914a9397920',
    geminiApiKey: 'AIzaSyC6CI9Wj_sEK6uDaqc3ck83V0tdS1uBARw',
    deepgramApiKey: '40433e03447f095c6de8d641f02e36e11dcdd65a',
    airtableApiKey: 'patELe8Evw4P2QKWu.bea7739a1c5b736178beff3832bbfc79c182a6696abe01321ee8d439ebd38c6f',
    airtableBaseId: 'appqwLWSuL2cxXtnU',


    // Element IDs (these don't need to be environment variables)
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

    // Validation method
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

// Validate configuration on load
if (!config.isConfigValid()) {
    console.error('Missing required API keys. Please check your configuration.');
} 