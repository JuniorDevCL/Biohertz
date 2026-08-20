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
  sendSmtpEmail.sender = { "name": "Biohertz Sistema", "email": process.env.EMAIL_SENDER };

  if (Array.isArray(emailDestino)) {
      sendSmtpEmail.to = emailDestino.map(email => ({ "email": email }));
  } else {
      sendSmtpEmail.to = [{ "email": emailDestino }];
  }

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Correo enviado con éxito. ID:', data.messageId);
    return data;
  } catch (error) {
    console.error('Error enviando correo con Brevo:', error);
    throw error;
  }
};

/** Credenciales de acceso al portal de clientes (clave solo en este correo) */
export const enviarCredencialesPortal = async (emailDestino, { nombre, clienteNombre, password, loginUrl }) => {
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_SENDER) {
    throw new Error('BREVO_API_KEY o EMAIL_SENDER no configurados');
  }

  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  const safeName = esc(nombre || 'Cliente');
  const org = clienteNombre ? ` (${esc(clienteNombre)})` : '';
  const url = esc(loginUrl || '/portal/login');
  const safeEmail = esc(emailDestino);
  const safePass = esc(password);

  sendSmtpEmail.subject = 'Acceso al portal de clientes — BIODATA';
  sendSmtpEmail.htmlContent = `
    <html><body style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.5">
      <p>Hola ${safeName}${org},</p>
      <p>Te habilitamos el acceso al <strong>portal de clientes BIODATA</strong> para consultar tus equipos y la próxima mantención.</p>
      <p><strong>Correo:</strong> ${safeEmail}<br>
         <strong>Clave temporal:</strong> <code style="font-size:16px;background:#f1f5f9;padding:4px 8px;border-radius:6px">${safePass}</code></p>
      <p>Ingresa aquí: <a href="${url}">${url}</a></p>
      <p style="color:#64748b;font-size:13px">Por seguridad, esta clave es personal. Si no solicitaste este acceso, ignora este mensaje o contacta a BIODATA.</p>
      <p>Saludos,<br>Equipo BIODATA</p>
    </body></html>`;
  sendSmtpEmail.sender = { name: 'BIODATA Portal', email: process.env.EMAIL_SENDER };
  sendSmtpEmail.to = [{ email: emailDestino }];

  const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
  console.log('Credenciales portal enviadas. ID:', data.messageId);
  return data;
};
