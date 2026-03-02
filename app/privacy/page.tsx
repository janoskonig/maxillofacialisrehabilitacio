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
              <strong>Policy Version:</strong> 1.0 &middot; <strong>Effective Date:</strong> March 2, 2026
            </p>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Data Controller</h2>
              <p>
                The data controller for the Maxillofacialis Rehabilitációs Rendszer (&ldquo;the Service&rdquo;) is:
              </p>
              <ul className="list-none pl-0 space-y-1">
                <li><strong>Name:</strong> König János</li>
                <li><strong>Email:</strong> <a href="mailto:janos.koenig@gmail.com" className="text-medical-primary hover:underline">janos.koenig@gmail.com</a></li>
              </ul>
              <p className="mt-3">
                Given the nature and scale of our data processing, we are not required to appoint a Data Protection Officer (DPO)
                under Article 37 of the GDPR. For any data protection inquiries, please contact the data controller directly at 
                the email address above.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Information We Collect</h2>
              
              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.1 Patient Information</h3>
              <p>We collect and store the following patient information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Personal identification (name, date of birth, gender)</li>
                <li>TAJ number (Hungarian social security number)</li>
                <li>Contact information (phone number, email address, postal address)</li>
                <li>Medical history, diagnosis, and treatment information (special category data under GDPR Art. 9)</li>
                <li>Appointment scheduling data</li>
                <li>Referral information from healthcare providers</li>
                <li>OHIP-14 quality-of-life questionnaire responses</li>
                <li>Uploaded medical documents</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.2 Healthcare Provider Account Information</h3>
              <p>For healthcare providers using the system, we collect:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Email address (used as username)</li>
                <li>Password (stored as a bcrypt hash; we never store plaintext passwords)</li>
                <li>Full name, role, institution, and access justification</li>
                <li>Activity logs for security and audit purposes</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.3 Google Calendar Integration</h3>
              <p>If you choose to connect your Google Calendar:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>OAuth tokens (encrypted at rest with AES-256-GCM)</li>
                <li>Calendar event IDs for appointment synchronization</li>
                <li>We do NOT access or store your full calendar data</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.4 Consent Records</h3>
              <p>We store records of your consent including timestamp, IP address, and the privacy policy version in effect at the time of consent.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. Legal Bases for Processing</h2>
              <p>We process personal data based on the following legal grounds under GDPR:</p>
              
              <div className="overflow-x-auto mt-3">
                <table className="min-w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Processing Activity</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Legal Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Patient health data processing</td>
                      <td className="border border-gray-200 px-3 py-2">Art. 9(2)(h) &ndash; Healthcare provision + explicit consent</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Staff account management</td>
                      <td className="border border-gray-200 px-3 py-2">Art. 6(1)(b) &ndash; Contract performance</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Google Calendar synchronization</td>
                      <td className="border border-gray-200 px-3 py-2">Art. 6(1)(a) &ndash; Consent</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">AI-generated anamnesis summaries (OpenAI)</td>
                      <td className="border border-gray-200 px-3 py-2">Art. 6(1)(a) &ndash; Consent</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Error tracking (Sentry, when enabled)</td>
                      <td className="border border-gray-200 px-3 py-2">Art. 6(1)(a) &ndash; Consent</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Email notifications</td>
                      <td className="border border-gray-200 px-3 py-2">Art. 6(1)(b) &ndash; Necessary for service delivery</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Security logging &amp; audit</td>
                      <td className="border border-gray-200 px-3 py-2">Art. 6(1)(f) &ndash; Legitimate interest (system security)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. How We Use Your Information</h2>
              <p>We use the collected information for the following purposes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Managing patient records and medical appointments</li>
                <li>Scheduling and coordinating appointments between healthcare providers</li>
                <li>Sending appointment notifications via email</li>
                <li>Synchronizing appointments with Google Calendar (if enabled)</li>
                <li>Generating AI-assisted clinical summaries (if consented; see Section 10)</li>
                <li>Maintaining security and preventing unauthorized access</li>
                <li>Complying with legal and regulatory requirements</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Data Security</h2>
              <p>We implement industry-standard security measures to protect your information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>All data is encrypted in transit using HTTPS/TLS</li>
                <li>OAuth tokens are encrypted at rest using AES-256-GCM encryption</li>
                <li>Passwords are hashed using bcrypt with salt</li>
                <li>Access is restricted based on user roles and permissions (RBAC)</li>
                <li>Database access is restricted and logged</li>
                <li>Event logs use hashed identifiers to avoid storing raw PII</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Data Sharing and Disclosure</h2>
              <p>We do not sell, trade, or rent your personal information. We may share information only in the following circumstances:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Healthcare Providers:</strong> Patient information is accessible to authorized healthcare providers involved in patient care</li>
                <li><strong>Legal Requirements:</strong> When required by law, court order, or government regulation</li>
                <li><strong>Sub-processors:</strong> With trusted third-party service providers who assist in operating our system (see Section 9), under strict data processing agreements</li>
                <li><strong>Emergency Situations:</strong> To protect the health and safety of patients or others</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Data Retention</h2>
              <p>We apply the following retention periods:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Patient medical records:</strong> 30 years from last treatment, as required by Hungarian healthcare law (1997. évi CLIV. törvény)</li>
                <li><strong>Staff accounts:</strong> Retained while the account is active; deleted upon request after deactivation</li>
                <li><strong>Event/audit logs:</strong> 3 years (automatically purged)</li>
                <li><strong>Consent records:</strong> Retained for the duration of the processing, plus 5 years after withdrawal</li>
                <li><strong>Session cookies:</strong> Deleted on logout or session expiry</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. Your Rights Under GDPR</h2>
              <p>You have the following rights regarding your personal data:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Right of Access (Art. 15):</strong> Request access to your personal data</li>
                <li><strong>Right to Rectification (Art. 16):</strong> Request correction of inaccurate data</li>
                <li><strong>Right to Erasure (Art. 17):</strong> Request deletion of your data (subject to legal retention obligations for medical records)</li>
                <li><strong>Right to Restriction (Art. 18):</strong> Request restriction of processing</li>
                <li><strong>Right to Data Portability (Art. 20):</strong> Request a machine-readable copy of your data</li>
                <li><strong>Right to Object (Art. 21):</strong> Object to processing based on legitimate interest</li>
                <li><strong>Right to Withdraw Consent (Art. 7):</strong> Withdraw consent at any time without affecting the lawfulness of prior processing</li>
              </ul>
              <p className="mt-3">
                Patients can exercise their data portability and erasure rights directly through the 
                patient portal (Profile section). For all other requests, please contact us at{' '}
                <a href="mailto:janos.koenig@gmail.com" className="text-medical-primary hover:underline">janos.koenig@gmail.com</a>.
                We will respond within 30 days.
              </p>
              <p className="mt-3">
                <strong>Right to Lodge a Complaint:</strong> If you believe your data protection rights have been violated, 
                you have the right to lodge a complaint with the Hungarian supervisory authority:
              </p>
              <ul className="list-none pl-6 space-y-1 mt-2">
                <li><strong>Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH)</strong></li>
                <li>Address: 1055 Budapest, Falk Miksa utca 9-11.</li>
                <li>Phone: +36 (1) 391-1400</li>
                <li>Email: ugyfelszolgalat@naih.hu</li>
                <li>Website: <a href="https://naih.hu" className="text-medical-primary hover:underline" target="_blank" rel="noopener noreferrer">https://naih.hu</a></li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">9. Third-Party Services and Sub-processors</h2>
              <p>Our system uses the following third-party services (sub-processors):</p>
              
              <div className="overflow-x-auto mt-3">
                <table className="min-w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Service</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Purpose</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Data Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Google Calendar API</td>
                      <td className="border border-gray-200 px-3 py-2">Appointment synchronization (optional, consent-based)</td>
                      <td className="border border-gray-200 px-3 py-2">EU/US (Google SCCs)</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">OpenAI API</td>
                      <td className="border border-gray-200 px-3 py-2">AI anamnesis summary generation (optional, consent-based)</td>
                      <td className="border border-gray-200 px-3 py-2">US (OpenAI DPA + SCCs)</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Sentry</td>
                      <td className="border border-gray-200 px-3 py-2">Error monitoring (optional, consent-based, PII scrubbed)</td>
                      <td className="border border-gray-200 px-3 py-2">US (Sentry DPA + SCCs)</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">SMTP Email Provider</td>
                      <td className="border border-gray-200 px-3 py-2">Transactional emails (appointments, verification)</td>
                      <td className="border border-gray-200 px-3 py-2">EU</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Google Fonts</td>
                      <td className="border border-gray-200 px-3 py-2">Font delivery (Inter typeface)</td>
                      <td className="border border-gray-200 px-3 py-2">Global CDN</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-3">
                Where data is transferred outside the EU/EEA, we rely on Standard Contractual Clauses (SCCs) 
                or equivalent safeguards as approved by the European Commission.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">10. AI Processing and Automated Decisions</h2>
              <p>
                Our system may use OpenAI&apos;s API to generate clinical anamnesis summaries from structured patient data. 
                This processing:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Is only performed when the AI feature is enabled and a healthcare provider initiates a NEAK export</li>
                <li>Does not make autonomous medical decisions &ndash; summaries are always reviewed by a healthcare professional</li>
                <li>Uses anonymized/pseudonymized data where possible (patient IDs, not names, are sent)</li>
                <li>All AI-generated content is clearly labeled as &ldquo;AI-generated summary &ndash; requires verification&rdquo;</li>
              </ul>
              <p className="mt-3">
                This does not constitute automated decision-making with legal effects under GDPR Art. 22, 
                as outputs are advisory and always subject to human review.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">11. Cookies and Local Storage</h2>
              <p>
                We use the following cookies and browser storage:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>auth-token</strong> (cookie): Session authentication for healthcare providers. Essential, deleted on logout.</li>
                <li><strong>patient_portal_session</strong> (cookie): Session authentication for patients. Essential, deleted on logout.</li>
                <li><strong>localStorage:</strong> UI preferences (banner dismissals, PWA prompts, role cache). No personal data.</li>
                <li><strong>sessionStorage:</strong> Temporary error/console logs for feedback reporting. Cleared on tab close.</li>
              </ul>
              <p className="mt-3">
                We do not use tracking cookies or third-party advertising/analytics cookies. 
                If Sentry error tracking is enabled, it requires your prior consent.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">12. Children&apos;s Privacy</h2>
              <p>
                Our system is designed for use by healthcare providers and may contain information about patients of all ages, 
                including minors. All patient information, including data of minors, is handled in accordance with GDPR and 
                applicable Hungarian healthcare privacy laws. For patients under 16, consent is provided by the 
                holder of parental responsibility.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">13. Data Breach Notification</h2>
              <p>
                In the event of a personal data breach that is likely to result in a risk to your rights and freedoms, 
                we will notify the NAIH within 72 hours of becoming aware of the breach (Art. 33). If the breach is likely 
                to result in a high risk, we will also notify affected individuals without undue delay (Art. 34).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">14. Changes to This Privacy Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. Material changes will be communicated via email 
                or in-app notification. The policy version and effective date are displayed at the top of this page. 
                Continued use after notification constitutes acceptance; for changes affecting consent-based processing, 
                we will seek renewed consent.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">15. Contact Us</h2>
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
