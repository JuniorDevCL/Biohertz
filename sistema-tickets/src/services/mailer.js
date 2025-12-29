import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  family: 4 // Fuerza IPv4 para evitar timeouts en Render
});

export async function enviarNotificacionTicket(emailDestino, tituloTicket) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: emailDestino,
      subject: 'Nuevo Ticket Asignado',
      text: `Hola,\n\nSe te ha asignado un nuevo trabajo: "${tituloTicket}".\n\nPor favor revisa el sistema de tickets para más detalles.\n\nSaludos,\nEquipo BIOHERTS`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Correo enviado:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error enviando correo:', error);
    throw error;
  }
}
