const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Generates a random key
/**
 * Generates a random key for passcode.
 * @returns string
 */
function gen_rand_key() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const characters = Array.from({ length: 20 }, () => alphabet[crypto.randomInt(alphabet.length)]);
    return characters.join('').match(/.{1,4}/g).join('-');
}

// Creates an activation file for key storage
/**
 * Create an Passcode file (Activation Code File) inside the main folder.
 * @param {*} filePath 
 * @returns 
 */
function create_activation_file(filePath = path.join(__dirname, '../..', 'passcode.txt')) {
    // For file exists
    if (fs.existsSync(filePath)) {
        const existingCode = fs.readFileSync(filePath, 'utf8').trim();
        // for key exists
        if (existingCode.length !== 0) {
            console.log(`Activation file path: ${filePath}`);
            console.log(`existing activation code found: ${existingCode}`);
            return existingCode;
        }
        else{
            console.log(`File exists without activation code`);
            const existingCode = null;
            return existingCode;
        }
    }
    // File not Found
    else{
        // Create a new activation code for initialization
        const newCode = gen_rand_key();
        fs.writeFileSync(filePath, newCode);
        console.log(`Activation file path: ${filePath}`);
        console.log(`Activation code: ${newCode}`);
        return newCode;
        // Imply the prevention for second generation of activation code
    }
}



module.exports = {
    gen_rand_key,
    create_activation_file
};