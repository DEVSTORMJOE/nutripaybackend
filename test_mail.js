const { sendMail } = require("./utils/mailer");

(async () => {
  try {
    const res = await sendMail({
      to: "test@example.com",
      subject: "Test email",
      text: "This is a test email."
    });
    console.log("Success:", res);
  } catch (err) {
    console.error("Error:", err);
  }
})();
