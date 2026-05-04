export { sendEmail } from './config';
export type { EmailAttachment, SendEmailOptions } from './config';
export { formatDateForEmail, formatDateForEmailShort, getBaseUrlForEmail } from './templates';
export {
  sendApprovalEmail,
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
  sendConditionalAppointmentNotificationToAdmin,
  sendNewAppointmentRequestToAdmin,
  sendNewMessageNotification,
  sendDoctorMessageNotification,
  sendConsiliumPrepShareEmail,
  sendConsiliumInvitationEmail,
  sendAppointmentReminderEmail,
  sendOhipReminderEmail,
} from './senders';
