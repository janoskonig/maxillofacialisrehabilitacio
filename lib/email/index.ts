export { sendEmail } from './config';
export type { EmailAttachment, SendEmailOptions } from './config';
export { formatDateForEmail, formatDateForEmailShort, getBaseUrlForEmail } from './templates';
export {
  sendApprovalEmail,
  sendPasswordResetEmail,
  sendPatientCreationNotification,
  sendAppointmentBookingNotification,
  sendAppointmentBookingNotificationToPatient,
  sendAppointmentBookingNotificationToAdmins,
  sendAppointmentCancellationNotification,
  sendAppointmentCancellationNotificationToPatient,
  sendAppointmentModificationNotification,
  sendAppointmentModificationNotificationToPatient,
  sendAppointmentTimeSlotFreedNotification,
  sendRegistrationNotificationToAdmins,
  sendPatientRegistrationNotificationToAdmins,
  sendPatientLoginNotificationToAdmins,
  sendConditionalAppointmentRequestToPatient,
  sendConditionalAppointmentNotificationToAdmin,
  sendNewAppointmentRequestToAdmin,
  sendNewMessageNotification,
  sendDoctorMessageNotification,
  sendAppointmentReminderEmail,
  sendOhipReminderEmail,
} from './senders';
