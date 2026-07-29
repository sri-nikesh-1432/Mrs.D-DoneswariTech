# Setup Guide for Mrs. D AI Telecalling Platform

## Required API Keys and Configuration

### 1. Gemini API Key (Already Configured)
- Get your API key at: https://makersuite.google.com/app/apikey
- Already set in your .env file as `GEMINI_API_KEY`

### 2. Twilio Configuration (Required for Phone Calls)
- Sign up at: https://www.twilio.com/try-twilio
- Get your credentials from: https://console.twilio.com
- Add these to your `.env` file:
  ```
  TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
  TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
  TWILIO_PHONE_NUMBER=+91XXXXXXXXXX
  ```

### 3. Voice Configuration
- The platform uses Edge-TTS for text-to-speech
- Indian female voices available:
  - `en-IN-NeerjaNeural` (Indian English female) - Recommended
  - `en-IN-HeeraNeural` (Indian English female)
  - `hi-IN-SwaraNeural` (Hindi female)
- Set in `.env` file:
  ```
  TTS_VOICE=en-IN-NeerjaNeural
  ```

## Installation Steps

### 1. Install Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cd backend
cp .env.example .env
# Edit .env file with your API keys
```

### 3. Initialize Database
```bash
cd backend
python -c "from app.database.database import init_db; import asyncio; asyncio.run(init_db())"
```

### 4. Start Backend Server
```bash
cd backend
python -m uvicorn app.main:app --host localhost --port 8000 --reload
```

### 5. Start Frontend (in separate terminal)
```bash
cd frontend
npm install
npm run dev
```

## RAG Pipeline Configuration

The RAG (Retrieval-Augmented Generation) pipeline is configured with these settings in `.env`:

```
# Embedding model
EMBEDDING_MODEL=all-MiniLM-L6-v2

# Chunk size (700-900 characters as per spec)
CHUNK_SIZE=800

# Chunk overlap (150 characters as per spec)
CHUNK_OVERLAP=150

# Number of relevant chunks to retrieve
TOP_K_RESULTS=5
```

## Document Upload

Upload your institute documents (PDF, DOCX, TXT, CSV) through the frontend:
1. Navigate to the Knowledge Base section
2. Upload your documents
3. The system will automatically:
   - Extract text
   - Chunk the content
   - Generate embeddings
   - Build the vector store
   - Make the knowledge available for retrieval

## Testing the RAG Pipeline

Run the test script to verify the pipeline:
```bash
cd backend
python test_rag_pipeline.py
```

## Single Student Call

To make a single call to a student:
1. Upload student list via the landing page
2. Use the "Single Student Call" section below the student list upload
3. Select a student and initiate the call
4. The AI will use the uploaded knowledge base to answer questions

## Troubleshooting

### Twilio Issues
- Ensure your Twilio account has sufficient credits
- Verify your phone number is verified in Twilio console
- Check that the phone number format includes country code (+91 for India)

### RAG Issues
- Ensure documents are uploaded successfully
- Check the vector store is ready (check logs)
- Verify embeddings are generated (check logs)
- Test retrieval with the test script

### Voice Issues
- Edge-TTS requires internet connection
- Try different voice options if the default doesn't work
- Check TTS_VOICE setting in .env

## API Keys Summary

Required API Keys:
1. **GEMINI_API_KEY** - For AI responses (already configured)
2. **TWILIO_ACCOUNT_SID** - For phone calls
3. **TWILIO_AUTH_TOKEN** - For phone calls authentication
4. **TWILIO_PHONE_NUMBER** - Your Twilio phone number

Optional Configuration:
- **TTS_VOICE** - Voice selection for TTS (default: en-IN-NeerjaNeural)
- **CHUNK_SIZE** - Document chunk size (default: 800)
- **CHUNK_OVERLAP** - Chunk overlap (default: 150)
- **TOP_K_RESULTS** - Number of chunks to retrieve (default: 5)

## Security Notes

- Never commit .env file to git
- Keep API keys secure
- Use different API keys for development and production
- Rotate API keys periodically
- Enable Twilio account security features
