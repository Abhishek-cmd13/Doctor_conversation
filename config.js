// Configuration management
const config = {
    // API Keys - Using Vercel's environment variables
    sarvamApiKey: process.env.SARVAM_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
    airtableApiKey: process.env.AIRTABLE_API_KEY || '',
    airtableBaseId: process.env.AIRTABLE_BASE_ID || '',

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