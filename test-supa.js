require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
    realtime: { transport: WebSocket }
});

async function test() {
    console.log("Fetching orders...");
    const { data, error } = await supabase.from('orders').select('*').limit(5);
    console.log("Error:", error);
    console.log("Data:", data);
}
test();
