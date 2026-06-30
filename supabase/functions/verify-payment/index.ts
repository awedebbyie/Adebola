import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {

  try {

    const body = await req.json();
    const reference = body.reference;

    if (!reference) {

      return new Response(
        JSON.stringify({
          success:false,
          error:"Missing reference"
        }),
        {
          status:400,
          headers:{
            "Content-Type":"application/json"
          }
        }
      );

    }

    const PAYSTACK_SECRET =
    Deno.env.get("PAYSTACK_SECRET");

    const SUPABASE_URL =
    Deno.env.get("SUPABASE_URL");

    const SUPABASE_SERVICE_ROLE =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const supabase =
    createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE!
    );

    // Check if transaction already exists
    const { data:existing } =
    await supabase
    .from("Transactions")
    .select("*")
    .eq("reference",reference)
    .maybeSingle();

    if(existing){

      return new Response(
        JSON.stringify({
          success:false,
          error:"Already processed"
        }),
        {
          headers:{
            "Content-Type":"application/json"
          }
        }
      );

    }

    const verifyResponse =
    await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers:{
          Authorization:
          `Bearer ${PAYSTACK_SECRET}`
        }
      }
    );

    const verifyData =
    await verifyResponse.json();

    if(
      !verifyData.data ||
      verifyData.data.status !== "success"
    ){

      return new Response(
        JSON.stringify({
          success:false,
          error:"Payment not completed"
        }),
        {
          headers:{
            "Content-Type":"application/json"
          }
        }
      );

    }

    await supabase
    .from("Transactions")
    .insert([{
      reference:reference,
      email:verifyData.data.customer.email,
      amount:verifyData.data.amount/100
    }]);

    return new Response(
      JSON.stringify({
        success:true,
        amount:
        verifyData.data.amount/100,
        email:
        verifyData.data.customer.email
      }),
      {
        headers:{
          "Content-Type":"application/json"
        }
      }
    );

  }

  catch(error:any){

    return new Response(
      JSON.stringify({
        success:false,
        error:error.message
      }),
      {
        status:500,
        headers:{
          "Content-Type":"application/json"
        }
      }
    );

  }

});