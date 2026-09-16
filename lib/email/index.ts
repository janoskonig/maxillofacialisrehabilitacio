export { sendEmail, isEmailDryRun } from './config';
export type { EmailAttachment, SendEmailOptions } from './config';
export { formatDateForEmail, formatDateForEmailShort, getBaseUrlForEmail } from './templates';
export {
  sendApprovalEmail,
  sendAccountInactiveNoticeEmail,
  sendPasswordResetEmail,
  sendAppointmentBookingNotification,
  sendAppointmentBookingNotificationToPatient,
  sendAppointmentBookingNotificationToAdmins,
  sendAppointmentCancellationNotification,
  sendAppointmentCancellationNotificationToPatient,
  sendAppointmentModificationNotification,
  sendAppointmentModificationNotificationToPatient,
  sendAppointmentTimeSlotFreedNotification,
  sendPatientRegistrationNotificationToAdmins,
  sendPatientLoginNotificationToAdmins,
  sendConditionalAppointmentRequestToPatient,
  sendCancellationWithNewOfferToPatient,
  sendConditionalAppointmentNotificationToAdmin,
  sendNewAppointmentRequestToAdmin,
  sendNewMessageNotification,
  sendDoctorMessageNotification,
  sendConsiliumPrepShareEmail,
  sendConsiliumInvitationEmail,
  sendAppointmentReminderEmail,
  sendOhipReminderEmail,
  sendConsentRequestEmail,
  sendTaskReminderEmail,
  sendMissingDataDigestEmail,
  sendFeedbackResponseEmail,
} from './senders';
export type { MissingDataDigestEntry, MissingDataDigestKind } from './senders';
