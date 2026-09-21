/**
 * lib/messages.js — Satu sumber format pesan order untuk WA + Telegram.
 *
 * WA memakai markdown Baileys: *bold*, _italic_.
 * Telegram memakai HTML: <b>, <i>, <code> (parse_mode=HTML).
 * Semua data user di-escape untuk Telegram agar <>& tidak merusak parse.
 */

function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function safe(v, fallback = "-") {
    const s = v === null || v === undefined ? "" : String(v);
    return s.trim() ? s : fallback;
}

// ---------- Helpers yang dicerminkan dari index.js (agar 1 sumber) ----------

function parseTargetNote(noteVal) {
    if (!noteVal) return "-";
    if (typeof noteVal !== "string") return String(noteVal);
    const trimmed = noteVal.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
            const parsed = JSON.parse(trimmed);
            return parsed.target || parsed.customer_id || trimmed;
        } catch (e) {
            // bukan JSON valid
        }
    }
    return noteVal;
}

function formatLicenses(licenses) {
    if (!licenses || licenses.length === 0) return "_Detail akun tidak tersedia. Hubungi admin._";
    return licenses
        .map((lic, i) => {
            if (typeof lic === "string") return i + 1 + ". " + lic;
            const lines = Object.entries(lic)
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => "   - " + k + ": *" + v + "*");
            return "*Akun " + (i + 1) + ":*\n" + lines.join("\n");
        })
        .join("\n\n");
}

function formatLicensesHtml(licenses) {
    if (!licenses || licenses.length === 0) return "<i>Detail akun tidak tersedia. Hubungi admin.</i>";
    return licenses
        .map((lic, i) => {
            if (typeof lic === "string") return `${i + 1}. ${escapeHtml(lic)}`;
            const lines = Object.entries(lic)
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => `   - ${escapeHtml(k)}: <b>${escapeHtml(v)}</b>`);
            return `<b>Akun ${i + 1}:</b>\n` + lines.join("\n");
        })
        .join("\n\n");
}

function formatFulfillmentDetails(order) {
    const details = order.account_details || {};
    const rawItems = details.raw_items || [];

    const h2hItems = rawItems.filter((item) => item.order_process === "h2h");
    const smmItems = rawItems.filter((item) => item.order_process === "smm");

    if (h2hItems.length > 0) {
        return h2hItems
            .map((item, i) => {
                let snList = "-";
                if (item.h2h_results) {
                    if (Array.isArray(item.h2h_results)) {
                        snList = item.h2h_results.map((res) => res.sn).filter(Boolean).join(", ") || "-";
                    } else if (typeof item.h2h_results === "object") {
                        snList = item.h2h_results.sn || "-";
                    } else if (typeof item.h2h_results === "string") {
                        snList = item.h2h_results;
                    }
                }
                const target = parseTargetNote(item.note || item.target);
                return (
                    `*Item ${i + 1}:* ${item.product_name} - ${item.variant_name}\n` +
                    `   - Target: *${target}*\n` +
                    `   - SN/Ref: *${snList}*\n` +
                    `   - Status: *Sukses*`
                );
            })
            .join("\n\n");
    } else if (smmItems.length > 0) {
        return smmItems
            .map((item, i) => {
                const target = parseTargetNote(item.note || item.target);
                return (
                    `*Item ${i + 1}:* ${item.product_name} - ${item.variant_name}\n` +
                    `   - Target: *${target}*\n` +
                    `   - Status: *Sukses*`
                );
            })
            .join("\n\n");
    } else {
        const licenses = details.licenses || [];
        if (licenses.length > 0) return formatLicenses(licenses);
    }

    if (rawItems.length > 0) {
        return rawItems
            .map((item, i) => {
                const target = parseTargetNote(item.note || item.target);
                return (
                    `*Item ${i + 1}:* ${item.variant_name || item.product_name || "Produk Digital"}\n` +
                    `   - Detail: *${target}*\n` +
                    `   - Status: *Sukses*`
                );
            })
            .join("\n\n");
    }

    return "_Detail akun tidak tersedia. Hubungi admin._";
}

function formatFulfillmentDetailsHtml(order) {
    const details = order.account_details || {};
    const rawItems = details.raw_items || [];

    const h2hItems = rawItems.filter((item) => item.order_process === "h2h");
    const smmItems = rawItems.filter((item) => item.order_process === "smm");

    if (h2hItems.length > 0) {
        return h2hItems
            .map((item, i) => {
                let snList = "-";
                if (item.h2h_results) {
                    if (Array.isArray(item.h2h_results)) {
                        snList = item.h2h_results.map((res) => res.sn).filter(Boolean).join(", ") || "-";
                    } else if (typeof item.h2h_results === "object") {
                        snList = item.h2h_results.sn || "-";
                    } else if (typeof item.h2h_results === "string") {
                        snList = item.h2h_results;
                    }
                }
                const target = parseTargetNote(item.note || item.target);
                return (
                    `<b>Item ${i + 1}:</b> ${escapeHtml(safe(item.product_name))} - ${escapeHtml(safe(item.variant_name))}\n` +
                    `   - Target: <b>${escapeHtml(target)}</b>\n` +
                    `   - SN/Ref: <b>${escapeHtml(snList)}</b>\n` +
                    `   - Status: <b>Sukses</b>`
                );
            })
            .join("\n\n");
    } else if (smmItems.length > 0) {
        return smmItems
            .map((item, i) => {
                const target = parseTargetNote(item.note || item.target);
                return (
                    `<b>Item ${i + 1}:</b> ${escapeHtml(safe(item.product_name))} - ${escapeHtml(safe(item.variant_name))}\n` +
                    `   - Target: <b>${escapeHtml(target)}</b>\n` +
                    `   - Status: <b>Sukses</b>`
                );
            })
            .join("\n\n");
    } else {
        const licenses = details.licenses || [];
        if (licenses.length > 0) return formatLicensesHtml(licenses);
    }

    if (rawItems.length > 0) {
        return rawItems
            .map((item, i) => {
                const target = parseTargetNote(item.note || item.target);
                return (
                    `<b>Item ${i + 1}:</b> ${escapeHtml(safe(item.variant_name || item.product_name || "Produk Digital"))}\n` +
                    `   - Detail: <b>${escapeHtml(target)}</b>\n` +
                    `   - Status: <b>Sukses</b>`
                );
            })
            .join("\n\n");
    }

    return "<i>Detail akun tidak tersedia. Hubungi admin.</i>";
}

function isPremiumApp(order) {
    const details = order.account_details || {};
    if (details.rrn || details.sn) return false;
    const rawItems = details.raw_items || [];
    if (rawItems.length === 0) return false;
    const hasH2H = rawItems.some((item) => item.order_process === "h2h" || item.order_process === "smm");
    if (hasH2H) return false;
    return true;
}

function isH2HOrder(order) {
    const rawItems = order?.account_details?.raw_items || [];
    return rawItems.some((item) => item.order_process === "h2h" || item.order_process === "smm");
}

// ---------- Builder utama: 1 order -> { waText, tgHtml } ----------

const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

function buildCompletedMessage(order) {
    const id = safe(order.id);
    const product = safe(order.product);
    const variant = safe(order.variant);
    const waNumber = safe(order.wa_number);
    const email = safe(order.email);

    if (isPremiumApp(order)) {
        const waText =
            "*PESANAN SELESAI!* ✅\n" + DIVIDER + "\n" +
            "Order: *" + id + "*\n" +
            "Produk: *" + product + "*\n" +
            "Varian: " + variant + "\n" +
            "WA: " + waNumber + "\n" +
            "Email: " + email + "\n" +
            DIVIDER + "\n" +
            "_Detail akun dikirim via email._\n" +
            "Terima kasih sudah berbelanja di *noxarianet store*!\n" +
            "Tinggalkan ulasan positif ya Kak!";

        const tgHtml =
            `<b>PESANAN SELESAI!</b> ✅\n${DIVIDER}\n` +
            `Order: <b>${escapeHtml(id)}</b>\n` +
            `Produk: <b>${escapeHtml(product)}</b>\n` +
            `Varian: ${escapeHtml(variant)}\n` +
            `WA: ${escapeHtml(waNumber)}\n` +
            `Email: ${escapeHtml(email)}\n` +
            `${DIVIDER}\n` +
            `<i>Detail akun dikirim via email.</i>\n` +
            `Terima kasih sudah berbelanja di <b>noxarianet store</b>!\n` +
            `Tinggalkan ulasan positif ya Kak!`;

        return { waText, tgHtml, kind: "premium" };
    }

    const h2h = isH2HOrder(order);
    const fulfillmentWa = formatFulfillmentDetails(order);
    const fulfillmentTg = formatFulfillmentDetailsHtml(order);
    const labelWa = h2h ? "*DETAIL TRANSAKSI:*" : "*DETAIL AKUN ANDA:*";
    const labelTg = h2h ? "<b>DETAIL TRANSAKSI:</b>" : "<b>DETAIL AKUN ANDA:</b>";
    const footerWa = h2h
        ? DIVIDER + "\nTerima kasih sudah berbelanja di *noxarianet store*!\nTinggalkan ulasan positif ya Kak!"
        : DIVIDER + "\n_Jangan share akun ini ke orang lain!_\nTerima kasih sudah berbelanja di *noxarianet store*!\nTinggalkan ulasan positif ya Kak!";
    const footerTg = h2h
        ? `${DIVIDER}\nTerima kasih sudah berbelanja di <b>noxarianet store</b>!\nTinggalkan ulasan positif ya Kak!`
        : `${DIVIDER}\n<i>Jangan share akun ini ke orang lain!</i>\nTerima kasih sudah berbelanja di <b>noxarianet store</b>!\nTinggalkan ulasan positif ya Kak!`;

    const waText =
        "*PESANAN SELESAI!*\n" + DIVIDER + "\n" +
        "Order: *" + id + "*\nProduk: *" + product + "*\n" +
        "Varian: " + variant + "\n" + DIVIDER + "\n" +
        labelWa + "\n\n" + fulfillmentWa + "\n\n" +
        "WA: " + waNumber + "\n" +
        "Email: " + email + "\n\n" +
        footerWa;

    const tgHtml =
        `<b>PESANAN SELESAI!</b>\n${DIVIDER}\n` +
        `Order: <b>${escapeHtml(id)}</b>\nProduk: <b>${escapeHtml(product)}</b>\n` +
        `Varian: ${escapeHtml(variant)}\n${DIVIDER}\n` +
        `${labelTg}\n\n${fulfillmentTg}\n\n` +
        `WA: ${escapeHtml(waNumber)}\n` +
        `Email: ${escapeHtml(email)}\n\n` +
        footerTg;

    return { waText, tgHtml, kind: h2h ? "h2h" : "standard" };
}

function buildFailedMessage(order) {
    const id = safe(order.id);
    const product = safe(order.product);
    const waNumber = safe(order.wa_number);
    const errMsg = safe(order.error_message, "Unknown");

    const waText =
        "*ORDER GAGAL!*\n" + DIVIDER + "\n" +
        "ID: *" + id + "*\n" + product + "\n" +
        "WA: " + waNumber + "\n" +
        "Error: _" + errMsg + "_\n*Perlu pengecekan manual!*";

    const tgHtml =
        `<b>ORDER GAGAL!</b>\n${DIVIDER}\n` +
        `ID: <b>${escapeHtml(id)}</b>\n${escapeHtml(product)}\n` +
        `WA: ${escapeHtml(waNumber)}\n` +
        `Error: <i>${escapeHtml(errMsg)}</i>\n<b>Perlu pengecekan manual!</b>`;

    return { waText, tgHtml, kind: "failed" };
}

module.exports = {
    escapeHtml,
    safe,
    parseTargetNote,
    formatLicenses,
    formatLicensesHtml,
    formatFulfillmentDetails,
    formatFulfillmentDetailsHtml,
    isPremiumApp,
    isH2HOrder,
    buildCompletedMessage,
    buildFailedMessage,
};
