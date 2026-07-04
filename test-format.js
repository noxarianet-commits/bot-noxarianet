function formatWaJid(waNumber) {
    let num = (waNumber || "").toString().replace(/\D/g, "");
    if (!num) return null;
    if (num.startsWith("0")) num = "62" + num.slice(1);
    else if (!num.startsWith("62")) num = "62" + num;
    return num + "@s.whatsapp.net";
}

const testNumber = "081999622231";
console.log("Test wa_number:", testNumber);
console.log("Formatted JID:", formatWaJid(testNumber));
