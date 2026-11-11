"use client";

import { useState } from "react";

export default function ShareCopy({ title, passage, pastorName, church, shareUrl }) {
  const [copied, setCopied] = useState("");
  const emailText = `Our family pack is ready: ${title} (${passage}).\n\nApproved by ${pastorName}, ${church}.\n\nRead it here: ${shareUrl}\n\nUse it Monday to Friday at home, then bring it to small group.`;
  const whatsappText = `Our family pack is ready: ${title} (${passage}), approved by ${pastorName}, ${church}. Read it here: ${shareUrl}`;

  async function copy(kind, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${kind} copy ready to paste.`);
    } catch {
      setCopied("Copy failed in this browser. Select the text from the share page instead.");
    }
  }

  return (
    <section style={{ border: "1px solid #ccc", padding: 12, marginBottom: 16 }}>
      <h2>Share this pack</h2>
      <p>
        <button onClick={() => copy("Email", emailText)}>Copy email text</button>{" "}
        <button onClick={() => copy("WhatsApp", whatsappText)}>Copy WhatsApp text</button>{" "}
        <a href={`mailto:?subject=${encodeURIComponent(`Family pack: ${title}`)}&body=${encodeURIComponent(emailText)}`}>Open email</a>{" "}
        <a href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}>Open WhatsApp</a>
      </p>
      {copied && <p>{copied}</p>}
      <p>No family data is sent by these buttons. They only copy text or open your own email and WhatsApp.</p>
    </section>
  );
}
