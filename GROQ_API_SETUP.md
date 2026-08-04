# Groq API Setup Guide

## What is Groq?

Groq is a high-performance AI inference platform that provides fast, low-latency access to large language models. We use Groq's Llama models for the AI Voice Receptionist.

## Getting Your Groq API Key

1. **Sign up for Groq**
   - Go to https://console.groq.com
   - Create a free account
   - Verify your email

2. **Get your API Key**
   - Navigate to https://console.groq.com/keys
   - Click "Create Key"
   - Copy the generated API key (starts with `gsk_`)

## Adding the API Key to Your Project

### Option 1: Using .env file (Recommended)

1. Create or edit the `.env` file in your backend directory:
   ```
   c:\Users\chint\OneDrive\Desktop\Doneswari Ai Telecaller\backend\.env
   ```

2. Add the following line:
   ```
   GROQ_API_KEY=your_actual_api_key_here
   ```

3. Save the file

### Option 2: Using Environment Variable (Windows PowerShell)

```powershell
$env:GROQ_API_KEY="your_actual_api_key_here"
```

### Option 3: Using Environment Variable (Windows CMD)

```cmd
set GROQ_API_KEY=your_actual_api_key_here
```

## Verifying the Setup

1. Restart the backend server:
   ```bash
   cd backend
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

2. Check the logs - you should see:
   ```
   Backend ready at http://localhost:8000
   ```

3. Test the API by visiting http://localhost:8000/docs

## Supported Groq Models

The platform uses the following Groq model by default:
- **llama-3.3-70b-versatile** - High-performance model for conversational AI

You can change the model in `backend/app/config/settings.py`:
```python
GROQ_MODEL: str = Field(default="llama-3.3-70b-versatile", env="GROQ_MODEL")
```

## Troubleshooting

### Error: "Groq API key not configured"
- Make sure you added the API key to your `.env` file
- Restart the backend server after adding the key

### Error: "Invalid API key"
- Verify your API key is correct (starts with `gsk_`)
- Check that you didn't add extra spaces or quotes

### Error: "Rate limit exceeded"
- Groq free tier has rate limits
- Consider upgrading to a paid plan for production use

## Pricing

Groq offers:
- **Free tier**: Limited requests per day
- **Paid tier**: Higher limits and priority access

Check https://groq.com/pricing for current pricing details.

## Security Notes

- Never commit your `.env` file to version control
- Never share your API key publicly
- Rotate your API key if it gets compromised
- Use environment variables in production deployments
