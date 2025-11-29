import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service - Maxillofacialis Rehabilitációs Rendszer',
  description: 'Terms of Service for Maxillofacialis Rehabilitációs Rendszer',
};

export default function TermsOfService() {
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
            <h1 className="text-3xl font-bold text-gray-900">Terms of Service</h1>
            <Link 
              href="/terms-hu" 
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
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Acceptance of Terms</h2>
              <p>
                By accessing and using the Maxillofacialis Rehabilitációs Rendszer ("the Service"), you accept and agree 
                to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, 
                please do not use this service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Description of Service</h2>
              <p>
                The Maxillofacialis Rehabilitációs Rendszer is a medical appointment booking and patient management system 
                designed for healthcare providers specializing in maxillofacial rehabilitation. The Service facilitates:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Patient record management</li>
                <li>Appointment scheduling between healthcare providers</li>
                <li>Time slot management for dental prosthetists</li>
                <li>Integration with Google Calendar (optional)</li>
                <li>Email notifications for appointments</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. User Accounts and Responsibilities</h2>
              
              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">3.1 Account Creation</h3>
              <p>
                To use the Service, you must create an account with a valid email address. You are responsible for 
                maintaining the confidentiality of your account credentials.
              </p>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">3.2 User Roles</h3>
              <p>The Service supports different user roles with varying permissions:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Admin:</strong> Full system access and user management</li>
                <li><strong>Sebészorvos (Surgeon):</strong> Can book appointments for patients</li>
                <li><strong>Fogpótlástanász (Dental Prosthetist):</strong> Can manage time slots and view appointments</li>
                <li><strong>Technikus (Technician):</strong> Limited access for technical operations</li>
                <li><strong>Editor:</strong> Can create and edit patient records</li>
                <li><strong>Viewer:</strong> Read-only access to patient records</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">3.3 User Responsibilities</h3>
              <p>You agree to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Provide accurate and complete information when creating your account</li>
                <li>Maintain and update your account information as necessary</li>
                <li>Keep your password secure and confidential</li>
                <li>Notify us immediately of any unauthorized use of your account</li>
                <li>Use the Service only for lawful purposes and in accordance with these Terms</li>
                <li>Comply with all applicable healthcare regulations and privacy laws</li>
                <li>Maintain patient confidentiality and data security</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Medical Information and HIPAA Compliance</h2>
              <p>
                The Service handles sensitive medical information. Users are responsible for:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Ensuring compliance with applicable healthcare privacy laws (including GDPR in Europe and relevant Hungarian regulations)</li>
                <li>Maintaining patient confidentiality</li>
                <li>Using the Service only for legitimate healthcare purposes</li>
                <li>Obtaining necessary patient consents where required</li>
                <li>Reporting any data breaches or security incidents immediately</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Prohibited Uses</h2>
              <p>You may not use the Service:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>For any unlawful purpose or to solicit others to perform unlawful acts</li>
                <li>To violate any international, federal, provincial, or state regulations, rules, laws, or local ordinances</li>
                <li>To infringe upon or violate our intellectual property rights or the intellectual property rights of others</li>
                <li>To harass, abuse, insult, harm, defame, slander, disparage, intimidate, or discriminate</li>
                <li>To submit false or misleading information</li>
                <li>To upload or transmit viruses or any other type of malicious code</li>
                <li>To collect or track the personal information of others</li>
                <li>To spam, phish, pharm, pretext, spider, crawl, or scrape</li>
                <li>For any obscene or immoral purpose</li>
                <li>To interfere with or circumvent the security features of the Service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Third-Party Integrations</h2>
              
              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">6.1 Google Calendar</h3>
              <p>
                The Service offers optional integration with Google Calendar. By enabling this feature:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>You authorize the Service to access your Google Calendar to create, update, and delete events</li>
                <li>You understand that calendar events will be created automatically when appointments are scheduled</li>
                <li>You can disconnect the integration at any time through your account settings</li>
                <li>You agree to comply with Google's Terms of Service and Privacy Policy</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Service Availability</h2>
              <p>
                We strive to provide continuous access to the Service, but we do not guarantee that the Service will be 
                available at all times. The Service may be unavailable due to:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Scheduled maintenance</li>
                <li>Unscheduled maintenance or repairs</li>
                <li>Technical failures</li>
                <li>Circumstances beyond our control</li>
              </ul>
              <p className="mt-3">
                We are not liable for any loss or damage resulting from Service unavailability.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. Intellectual Property</h2>
              <p>
                The Service and its original content, features, and functionality are owned by Maxillofacialis Rehabilitációs 
                Rendszer and are protected by international copyright, trademark, patent, trade secret, and other intellectual 
                property laws.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">9. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by law, Maxillofacialis Rehabilitációs Rendszer shall not be liable for any 
                indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether 
                incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses resulting from 
                your use of the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">10. Indemnification</h2>
              <p>
                You agree to defend, indemnify, and hold harmless Maxillofacialis Rehabilitációs Rendszer and its officers, 
                directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses, 
                including without limitation reasonable legal and accounting fees, arising out of or in any way connected with 
                your access to or use of the Service or your violation of these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">11. Termination</h2>
              <p>
                We may terminate or suspend your account and access to the Service immediately, without prior notice or liability, 
                for any reason, including if you breach these Terms. Upon termination, your right to use the Service will 
                cease immediately.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">12. Changes to Terms</h2>
              <p>
                We reserve the right to modify these Terms at any time. We will notify users of any material changes by 
                posting the new Terms on this page and updating the "Last Updated" date. Your continued use of the Service 
                after such changes constitutes acceptance of the new Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">13. Governing Law</h2>
              <p>
                These Terms shall be governed by and construed in accordance with the laws of Hungary, without regard to 
                its conflict of law provisions.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">14. Contact Information</h2>
              <p>
                If you have any questions about these Terms of Service, please contact us at:
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

