/**
 * lib/refund.js — Deteksi refund saldo untuk order yang gagal.
 *
 * Backend mencatat setiap refund saldo sebagai baris di `balance_transactions`
 * (`type='refund'`, `reference_id = orders.id`, `status='completed'`). Baris
 * itulah bukti bahwa saldo benar-benar sudah kembali ke akun pembeli — bot
 * tidak menebaknya hanya dari status order.
 *
 * Refund ke saldo hanya berlaku untuk order `payment_type='balance'` yang
 * punya `user_id` (order gateway tidak pernah memotong saldo).
 *
 * Catatan penting: backend menulis `status='FAILED'` DULU, baru memanggil
 * refund, sehingga event Realtime bisa tiba sebelum baris refund ada. Karena
 * itu pencarian diulang beberapa kali dengan jeda singkat.
 */

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_DELAY_MS = 800;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBalanceOrder(order) {
    return String(order?.payment_type || "").toLowerCase() === "balance" && Boolean(order?.user_id);
}

async function findCompletedRefund(supabase, order) {
    let query = supabase
        .from("balance_transactions")
        .select("amount, created_at")
        .eq("reference_id", order.id)
        .eq("type", "refund")
        .eq("status", "completed")
        .limit(1);

    if (order.user_id) query = query.eq("user_id", order.user_id);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data || null;
}

/**
 * Cari bukti refund saldo untuk sebuah order.
 *
 * @returns {Promise<{applies: boolean, refunded: boolean, amount?: number|null, at?: string|null}>}
 *   - `applies=false`  : order gateway / tanpa user_id — tidak ada refund saldo.
 *   - `refunded=true`  : baris refund ditemukan, saldo sudah dikembalikan.
 *   - `refunded=false` : order saldo tapi belum ada bukti (mis. REFUND_PENDING).
 *
 * Tidak pernah melempar error: kegagalan query hanya di-log dan notifikasi
 * order tetap dikirim.
 */
async function resolveRefundInfo(supabase, order, opts = {}) {
    if (!order?.id) return { applies: false, refunded: false };
    if (!isBalanceOrder(order)) return { applies: false, refunded: false };

    const fallbackAmount = Number(order.price) || null;
    if (!supabase) return { applies: true, refunded: false, amount: fallbackAmount };

    const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
    const delayMs = Math.max(0, opts.delayMs ?? DEFAULT_DELAY_MS);

    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const refund = await findCompletedRefund(supabase, order);
            if (refund) {
                return {
                    applies: true,
                    refunded: true,
                    amount: Number(refund.amount) || fallbackAmount,
                    at: refund.created_at || null,
                };
            }
            lastError = null;
        } catch (err) {
            lastError = err;
        }
        if (attempt < attempts) await sleep(delayMs);
    }

    if (lastError) {
        console.error(`[!] Gagal cek refund ${order.id}:`, lastError.message);
    }

    return { applies: true, refunded: false, amount: fallbackAmount };
}

module.exports = {
    isBalanceOrder,
    findCompletedRefund,
    resolveRefundInfo,
};
