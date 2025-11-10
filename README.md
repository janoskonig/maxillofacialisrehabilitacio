# Maxillofacial Rehabilitation - Patient Data Collection System

A modern, professional web application for collecting and managing structured patient data specifically designed for maxillofacial rehabilitation practices.

## Features

### 🏥 Comprehensive Patient Management
- **Complete Patient Profiles**: Capture all essential patient information including demographics, medical history, and contact details
- **Maxillofacial-Specific Fields**: Specialized forms for facial trauma assessment, current symptoms, and treatment planning
- **Medical Record Integration**: Track medical record numbers, referring physicians, and insurance information

### 📋 Structured Data Collection
- **Multi-Section Forms**: Organized into logical sections (Basic Info, Medical History, Assessment, Treatment Plan)
- **Conditional Fields**: Dynamic form fields that appear based on patient responses (e.g., trauma details)
- **Symptom Tracking**: Comprehensive checklist for current symptoms with pain level assessment
- **Treatment Planning**: Document treatment goals, recommended procedures, and follow-up requirements

### 🔍 Advanced Search & Management
- **Real-time Search**: Search patients by name, medical record number, phone, or email
- **Patient List View**: Clean, professional table view with key patient information
- **Quick Actions**: Edit and delete patient records with confirmation dialogs
- **Statistics Dashboard**: View total patients, search results, and monthly additions

### 🎨 Professional Medical UI
- **Clean, Modern Design**: Professional medical-grade interface with proper color coding
- **Responsive Layout**: Works seamlessly on desktop, tablet, and mobile devices
- **Accessibility**: Proper form labels, keyboard navigation, and screen reader support
- **Medical Color Scheme**: Professional blue color palette appropriate for healthcare

### 🔒 Data Security & Validation
- **Form Validation**: Comprehensive client-side validation using Zod schema
- **Type Safety**: Full TypeScript implementation for robust data handling
- **Local Storage**: Secure local data storage (ready for future database integration)
- **Error Handling**: User-friendly error messages and validation feedback

## Technology Stack

- **Frontend**: Next.js 14 with React 18
- **Language**: TypeScript for type safety
- **Styling**: Tailwind CSS with custom medical theme
- **Forms**: React Hook Form with Zod validation
- **Icons**: Lucide React for consistent iconography
- **Date Handling**: date-fns for reliable date formatting
- **Google Calendar**: googleapis for OAuth2 integration

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn package manager
- PostgreSQL database
- SMTP server for email notifications
- Google Cloud Console project (for Google Calendar integration - optional)

### Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file in the root directory with the following variables:
   
   **Required:**
   - `DATABASE_URL` - PostgreSQL connection string
   - `JWT_SECRET` - Secret key for JWT tokens (random string)
   - `SMTP_HOST` - SMTP server hostname
   - `SMTP_PORT` - SMTP server port (usually 587)
   - `SMTP_USER` - SMTP username
   - `SMTP_PASS` - SMTP password
   - `SMTP_FROM` - Email address for sending emails
   
   **Optional (Google Calendar Integration):**
   - `GOOGLE_CLIENT_ID` - Google OAuth2 Client ID
   - `GOOGLE_CLIENT_SECRET` - Google OAuth2 Client Secret
   - `GOOGLE_REDIRECT_URI` - OAuth2 redirect URI (optional, auto-generated if not set)
   - `ENCRYPTION_KEY` - 32-byte encryption key for token storage (64 hex characters or 32 UTF-8 characters)
   - `NEXT_PUBLIC_APP_URL` - Public application URL (optional, auto-detected if not set)

3. **Database Setup**
   Run the database migrations:
   ```bash
   psql -d <database_name> -f database/schema.sql
   psql -d <database_name> -f database/migration_google_calendar_tokens.sql
   psql -d <database_name> -f database/migration_appointments_google_calendar_event_id.sql
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

5. **Open Application**
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser

### Google Calendar Integration Setup

1. **Create Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the Google Calendar API

2. **Create OAuth2 Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - `http://localhost:3000/api/google-calendar/callback` (development)
     - `https://yourdomain.com/api/google-calendar/callback` (production)
   - Copy the Client ID and Client Secret

3. **Set Environment Variables**
   Add to your `.env` file:
   ```
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   ENCRYPTION_KEY=your_32_byte_key_here
   ```

4. **Generate Encryption Key**
   You can generate a secure encryption key using:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. **Connect Google Calendar**
   - Log in to the application
   - Go to Settings page
   - Click "Google Calendar összekötése"
   - Authorize the application
   - Appointments will now automatically sync to Google Calendar

### Building for Production

```bash
npm run build
npm start
```

## Usage

### Adding a New Patient
1. Click the "New Patient" button in the top-right corner
2. Fill out the comprehensive patient form across all sections:
   - **Basic Information**: Demographics and contact details
   - **Address Information**: Complete address details
   - **Medical Information**: Medical history, allergies, medications
   - **Maxillofacial Assessment**: Trauma history, symptoms, pain levels
   - **Treatment Plan**: Goals, procedures, follow-up scheduling
   - **Insurance Information**: Provider details and emergency contacts
3. Click "Save Patient" to store the record

### Managing Patients
- **Search**: Use the search bar to find patients by any field
- **Edit**: Click the edit icon to modify patient information
- **Delete**: Click the delete icon to remove patient records (with confirmation)
- **View**: Patient information is displayed in an organized table format

### Data Storage
- All patient data is stored locally in your browser
- Data persists between sessions
- Ready for future database integration

## Form Sections

### Basic Information
- First/Last Name, Date of Birth, Gender
- Phone number and email address
- Complete address information

### Medical Information
- Medical record number and referring physician
- Chief complaint and medical history
- Allergies and current medications

### Maxillofacial Assessment
- Facial trauma history with conditional details
- Previous surgeries
- Current symptoms checklist (12 common symptoms)
- Pain level assessment (0-10 scale)
- Functional limitations and aesthetic concerns

### Treatment Plan
- Treatment goals and recommended procedures
- Follow-up scheduling
- Insurance and emergency contact information

## Customization

### Adding New Fields
1. Update the `patientSchema` in `lib/types.ts`
2. Add form fields to `components/PatientForm.tsx`
3. Update the `PatientList` component if needed

### Styling Changes
- Modify `tailwind.config.js` for color scheme changes
- Update `app/globals.css` for custom component styles
- Medical color palette is defined in the Tailwind config

## Future Enhancements

- **Database Integration**: Replace local storage with proper database
- **User Authentication**: Add login system for multiple users
- **Data Export**: Export patient data to PDF or CSV
- **Appointment Scheduling**: Integrated calendar system
- **Photo Upload**: Add before/after photos for treatment tracking
- **Reporting**: Generate treatment reports and statistics

## Support

This application is designed specifically for maxillofacial rehabilitation practices. The form structure and fields are tailored to capture the specific data needs of this medical specialty.

For technical support or customization requests, please refer to the development team.

