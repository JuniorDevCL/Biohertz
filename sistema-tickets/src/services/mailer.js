import SibApiV3Sdk from 'sib-api-v3-sdk';

const defaultClient = SibApiV3Sdk.ApiClient.instance;

// Configurar la API Key
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

export const enviarNotificacionTicket = async (emailDestino, tituloTicket) => {
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

  sendSmtpEmail.subject = "¡Nuevo Ticket Asignado! - Biohertz";
  sendSmtpEmail.htmlContent = `<html><body><p>Hola,</p><p>Se te ha asignado un nuevo trabajo: "<strong>${tituloTicket}</strong>".</p><p>Por favor revisa el sistema de tickets para más detalles.</p><p>Saludos,<br>Equipo BIOHERTZ</p></body></html>`;
  sendSmtpEmail.sender = { "name": "Biohertz Sistema", "email": process.env.EMAIL_SENDER }; // Tu correo Gmail o verificado en Brevo
  sendSmtpEmail.to = [{ "email": emailDestino }];

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Correo enviado con éxito. ID:', data.messageId);
    return data;
  } catch (error) {
    console.error('Error enviando correo con Brevo:', error);
    throw error;
  }
};
