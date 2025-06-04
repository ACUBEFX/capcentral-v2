// views/payView.js
module.exports = function() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Success</title>
      <style>
        body { font-family: 'Inter', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
        .success-container { max-width: 400px; margin: 100px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.09); padding: 40px; text-align: center;}
        .success-check { font-size: 4em; color: #27ae60; margin-bottom: 20px;}
      </style>
    </head>
    <body>
      <div class="success-container">
        <div class="success-check">&#10004;</div>
        <h2>Payment processed!</h2>
        <p>Thank you for your order.</p>
        <a href="/" style="color:#262626;text-decoration:underline;">Return to shop</a>
      </div>
    </body>
    </html>
  `;
};