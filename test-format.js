function formatWaJid(waNumber) {
    let num = (waNumber || "").toString().replace(/\D/g, "");
    if (!num) return null;
    if (num.startsWith("0")) num = "62" + num.slice(1);
    else if (num.startsWith("620")) num = "62" + num.slice(3);
    else if (!num.startsWith("62")) num = "62" + num;
    return num + "@s.whatsapp.net";
}

const testCases = [
    "+6285138200346",
    "083803541121",
    "62085936603517",
    "+62085936603517",
    "085936603517"
];

testCases.forEach(tc => {
    console.log(`Original: ${tc.padEnd(20)} -> Formatted JID: ${formatWaJid(tc)}`);
});
