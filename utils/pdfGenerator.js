const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs'); // Import fs module to handle directory creation

// Function to generate PDF from HTML content
module.exports = async function generatePDF(htmlContent) {
    // Define the directory path for storing PDFs
    const dirPath = path.join(__dirname, 'generated_pdfs');

    // Check if the directory exists, if not, create it
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true }); // Create the directory if it doesn't exist
    }

    // Launch the browser (headless by default)
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Set the HTML content in the page
    await page.setContent(htmlContent);

    // Define the file path for saving the PDF
    const filePath = path.join(dirPath, 'service_payment_confirmation.pdf');

    // Generate the PDF and save it to the file path
    await page.pdf({
        path: filePath, // Save the PDF here
        format: 'A4',   // Page size (A4)
        printBackground: true, // Ensures background colors/images are included
    });

    // Close the browser after PDF generation
    await browser.close();

    // Return the path of the generated PDF
    return filePath;
};
