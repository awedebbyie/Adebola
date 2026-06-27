const WebSocket = require('ws');
global.WebSocket = WebSocket;

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const { createClient } =
require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_KEY
);

const PAYSTACK_SECRET_KEY =
process.env.PAYSTACK_SECRET_KEY;



app.post("/verify-payment", async (req,res)=>{

try{

const {reference,email}=req.body;

const response =
await axios.get(
`https://api.paystack.co/transaction/verify/${reference}`,
{
headers:{
Authorization:
`Bearer ${PAYSTACK_SECRET_KEY}`
}
}
);

const tx=response.data.data;

if(tx.status==="success"){

const amount=tx.amount/100;

const {data:user}=await supabase
.from("users")
.select("*")
.eq("email",email)
.single();

const newBalance=
(user.balance||0)+amount;

await supabase
.from("users")
.update({
balance:newBalance
})
.eq("email",email);

return res.json({
success:true
});

}

res.json({
success:false
});

}catch(error){

console.log(error);

res.status(500).json({
error:"Verification failed"
});

}

});



app.listen(3000,()=>{
console.log(
"Server running on port 3000"
);
});