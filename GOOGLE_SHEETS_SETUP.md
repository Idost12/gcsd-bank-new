# Google Sheets Backend Setup Guide

This guide will help you set up Google Sheets as your backend to replace Supabase and avoid usage limits.

## Step 1: Create a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it "GCSD Bank Data" (or any name you prefer)
4. Create a sheet named "Data" (this is where all your app data will be stored)
5. In the "Data" sheet, set up two columns:
   - Column A: "Key" (this will store your data keys like "gcs-v4-core", "gcs-v4-stock", etc.)
   - Column B: "Value" (this will store the JSON data)

## Step 2: Get Your Sheet ID

1. Open your Google Sheet
2. Look at the URL: `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`
3. Copy the `YOUR_SHEET_ID` part

## Step 3: Enable Google Sheets API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the Google Sheets API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click on it and press "Enable"

## Step 4: Create an API Key

1. In Google Cloud Console, go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "API Key"
3. Copy the generated API key
4. (Optional) Restrict the API key to only work with Google Sheets API for security

## Step 5: Configure Your App

1. Copy `.env.example` to `.env` in your project root
2. Fill in your values:
   ```
   VITE_GOOGLE_SHEET_ID=your_actual_sheet_id
   VITE_GOOGLE_API_KEY=your_actual_api_key
   ```

## Step 6: Test the Setup

1. Run your app: `npm run dev`
2. The app should now use Google Sheets instead of Supabase
3. Check your Google Sheet - you should see data appearing in the "Data" sheet

## Data Structure

Your Google Sheet will store data like this:

| Key | Value |
|-----|-------|
| gcs-v4-core | {"accounts":[...],"txns":[...]} |
| gcs-v4-stock | {"airfryer":1,"soundbar":1,...} |
| gcs-v4-pins | {"agent1":"1234","agent2":"5678"} |
| gcs-v4-goals | {"agent1":1000,"agent2":2000} |

## Benefits

- ✅ **Free**: No usage limits or costs
- ✅ **Reliable**: Google's infrastructure
- ✅ **Accessible**: View/edit data directly in Google Sheets
- ✅ **Backup**: Automatic Google Drive backup
- ✅ **Collaborative**: Share with team members if needed

## Troubleshooting

- **"Missing Google Sheets config"**: Check your `.env` file has the correct values
- **"HTTP 403"**: Your API key might not have permission, check Google Cloud Console
- **"HTTP 404"**: Check your Sheet ID is correct
- **Data not updating**: Check the "Data" sheet exists and has the right column headers

## Migration from Supabase

If you have existing data in Supabase, you can export it and manually add it to your Google Sheet, or the app will start fresh with default data.