const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { amount } = req.body;

    if (amount === undefined || amount === null) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    // Convert dollars to cents (Stripe uses cents)
    const amountInCents = Math.round(parseFloat(amount) * 100);

    if (isNaN(amountInCents) || amountInCents <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const recipientEmail = process.env.RECIPIENT_EMAIL;
    const recipientName = process.env.RECIPIENT_NAME || recipientEmail;

    if (!recipientEmail) {
      return res.status(500).json({ error: 'RECIPIENT_EMAIL not configured' });
    }

    // Find or create customer by email
    let customer;
    const existingCustomers = await stripe.customers.list({
      email: recipientEmail,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: recipientEmail,
        name: recipientName
      });
    }

    // Create invoice first (as draft)
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 30,
      auto_advance: false
    });

    // Add the line item to this specific invoice
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: amountInCents,
      currency: 'usd',
      description: 'Services'
    });

    // Finalize the invoice
    await stripe.invoices.finalizeInvoice(invoice.id);

    // Send the invoice
    const sentInvoice = await stripe.invoices.sendInvoice(invoice.id);

    return res.status(200).json({
      success: true,
      invoiceId: sentInvoice.id,
      invoiceUrl: sentInvoice.hosted_invoice_url,
      amount: amount,
      amountCents: amountInCents
    });

  } catch (error) {
    console.error('Error creating invoice:', error);
    return res.status(500).json({
      error: 'Failed to create invoice',
      message: error.message
    });
  }
};
