import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy - Maxillofacialis Rehabilitációs Rendszer',
  description: 'Privacy Policy for Maxillofacialis Rehabilitációs Rendszer',
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm p-8">
          <div className="mb-6">
            <Link href="/" className="text-medical-primary hover:underline text-sm">
              ← Back to Home
            </Link>
          </div>
          
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
            <Link 
              href="/privacy-hu" 
              className="text-sm text-medical-primary hover:underline"
            >
              Magyar verzió
            </Link>
          </div>

          <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
            <p className="text-sm text-gray-600">
              <strong>Last Updated:</strong> {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Introduction</h2>
              <p>
                Maxillofacialis Rehabilitációs Rendszer ("we," "our," or "us") is committed to protecting your privacy. 
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use 
                our medical appointment booking and patient management system.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Information We Collect</h2>
              
              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.1 Patient Information</h3>
              <p>We collect and store the following patient information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Personal identification (name, date of birth, gender)</li>
                <li>TAJ number (Hungarian social security number)</li>
                <li>Contact information (phone number, email address, address)</li>
                <li>Medical history and treatment information</li>
                <li>Appointment scheduling data</li>
                <li>Referral information from healthcare providers</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.2 User Account Information</h3>
              <p>For healthcare providers using the system, we collect:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Email address (used as username)</li>
                <li>Password (encrypted and hashed)</li>
                <li>Role and permissions</li>
                <li>Activity logs for security and audit purposes</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.3 Google Calendar Integration</h3>
              <p>If you choose to connect your Google Calendar:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>OAuth tokens (encrypted and stored securely)</li>
                <li>Calendar event IDs for appointment synchronization</li>
                <li>We do NOT access or store your full calendar data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. How We Use Your Information</h2>
              <p>We use the collected information for the following purposes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Managing patient records and medical appointments</li>
                <li>Scheduling and coordinating appointments between healthcare providers</li>
                <li>Sending appointment notifications via email</li>
                <li>Synchronizing appointments with Google Calendar (if enabled)</li>
                <li>Maintaining security and preventing unauthorized access</li>
                <li>Complying with legal and regulatory requirements</li>
                <li>Improving system functionality and user experience</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Data Security</h2>
              <p>We implement industry-standard security measures to protect your information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>All data is encrypted in transit using HTTPS/TLS</li>
                <li>OAuth tokens are encrypted at rest using AES-256-GCM encryption</li>
                <li>Passwords are hashed using secure hashing algorithms</li>
                <li>Access is restricted based on user roles and permissions</li>
                <li>Regular security audits and monitoring</li>
                <li>Database access is restricted and logged</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Data Sharing and Disclosure</h2>
              <p>We do not sell, trade, or rent your personal information. We may share information only in the following circumstances:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Healthcare Providers:</strong> Patient information is accessible to authorized healthcare providers involved in patient care</li>
                <li><strong>Legal Requirements:</strong> When required by law, court order, or government regulation</li>
                <li><strong>Service Providers:</strong> With trusted third-party service providers who assist in operating our system (e.g., hosting, email services), under strict confidentiality agreements</li>
                <li><strong>Emergency Situations:</strong> To protect the health and safety of patients or others</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Your Rights</h2>
              <p>You have the following rights regarding your personal information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Access:</strong> Request access to your personal information</li>
                <li><strong>Correction:</strong> Request correction of inaccurate information</li>
                <li><strong>Deletion:</strong> Request deletion of your information (subject to legal retention requirements)</li>
                <li><strong>Objection:</strong> Object to certain processing of your information</li>
                <li><strong>Data Portability:</strong> Request a copy of your data in a portable format</li>
                <li><strong>Withdraw Consent:</strong> Withdraw consent for Google Calendar integration at any time</li>
              </ul>
              <p className="mt-3">
                To exercise these rights, please contact us at <a href="mailto:janos.koenig@gmail.com" className="text-medical-primary hover:underline">janos.koenig@gmail.com</a>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Data Retention</h2>
              <p>
                We retain patient information for as long as necessary to provide healthcare services and comply with 
                legal and regulatory requirements. Medical records may be retained for extended periods as required by 
                healthcare regulations in Hungary.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. Cookies and Tracking</h2>
              <p>
                We use session cookies to maintain your login session. These cookies are essential for the system to 
                function and are deleted when you log out. We do not use tracking cookies or third-party analytics 
                that collect personal information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">9. Third-Party Services</h2>
              <p>Our system integrates with the following third-party services:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Google Calendar API:</strong> For appointment synchronization (only if you explicitly enable this feature)</li>
                <li><strong>Email Services:</strong> For sending appointment notifications</li>
              </ul>
              <p className="mt-3">
                These services have their own privacy policies. We recommend reviewing Google's Privacy Policy 
                if you use the Google Calendar integration.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">10. Children's Privacy</h2>
              <p>
                Our system is designed for use by healthcare providers and may contain information about patients of all ages, 
                including minors. All patient information is handled in accordance with applicable healthcare privacy laws.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">11. Changes to This Privacy Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify users of any material changes by 
                posting the new Privacy Policy on this page and updating the "Last Updated" date.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">12. Contact Us</h2>
              <p>
                If you have any questions or concerns about this Privacy Policy or our data practices, please contact us at:
              </p>
              <p className="mt-2">
                <strong>Email:</strong> <a href="mailto:janos.koenig@gmail.com" className="text-medical-primary hover:underline">janos.koenig@gmail.com</a>
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

