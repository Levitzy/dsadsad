const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const querystring = require('querystring');
const { Random } = require('random-js');
const random = new Random();
const cheerio = require('cheerio');
const https = require('https');

/**
 * Enhanced Facebook Account Creator PRO
 * This module creates Facebook accounts using temporary emails
 * with improved security bypass and verification handling
 */
module.exports = {
    name: 'fbcreator',
    description: 'Create a Facebook account with a temporary email',
    cooldown: 300, // 5 minutes cooldown to avoid detection by Facebook

    /**
     * Execute the Facebook account creation process
     * @param {Object} api - Bot API object for sending messages
     * @param {Object} event - Event object containing threadID and messageID
     * @param {Array} args - Command arguments
     */
    async execute(api, event, args) {
        // Check command variant for verification
        if (args.length > 0 && args[0].toLowerCase() === 'verify') {
            return this.handleVerification(api, event, args.slice(1));
        }

        // Validate arguments
        if (args.length < 1) {
            api.sendMessage("❌ Please provide a temporary email address.\nUsage: fbcreator youremail@example.com\n\nTo verify an account: fbcreator verify yourcode", event.threadID, event.messageID);
            return;
        }

        const email = args[0];
        let emailPassword = args.length > 1 ? args[1] : null;

        // Validate email format
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email)) {
            api.sendMessage("❌ Invalid email format. Please provide a valid email address.", event.threadID, event.messageID);
            return;
        }

        // Check for risky email patterns that Facebook might block
        const riskyPatterns = ['temp', 'disposable', 'throwaway', 'fake', 'tmp', 'temporary'];
        const isRiskyEmail = riskyPatterns.some(pattern => email.toLowerCase().includes(pattern));

        if (isRiskyEmail) {
            api.sendMessage("⚠️ Warning: This email contains patterns that Facebook might detect as temporary. Consider using a less obvious temporary mail service.", event.threadID, event.messageID);
        }

        // Send starting message
        api.sendMessage("📱 Starting Facebook account creation process...", event.threadID, event.messageID);

        try {
            // Generate random user data
            const userData = generateUserData();

            // Send user data information
            const userInfoMessage = `
👤 Account Information:
- Name: ${userData.firstName} ${userData.lastName}
- Gender: ${userData.gender === "1" ? "Female" : "Male"}
- DOB: ${userData.birthMonth}/${userData.birthDay}/${userData.birthYear}
- Email: ${email}
- Password: ${userData.password}

⏳ Attempting to create Facebook account...
Please wait, this might take a few minutes.
`;
            api.sendMessage(userInfoMessage, event.threadID);

            // Create session with security-bypassing agent
            const session = createEnhancedSession();

            // Use a multi-stage approach to maximize success chances
            const accountInfo = await createFacebookAccountMultiStage(session, userData, email, api, event);

            if (accountInfo.success) {
                // Save account information to file
                const savedPath = saveAccountInfo(userData, email, emailPassword, accountInfo);

                // Success message
                let successMessage = `
✅ Facebook Account Created Successfully!

👤 Account Information:
- Name: ${userData.firstName} ${userData.lastName}
- Gender: ${userData.gender === "1" ? "Female" : "Male"}
- Email: ${email}
- Password: ${userData.password}
${accountInfo.userId ? `- User ID: ${accountInfo.userId}` : ''}

🔐 Account information saved to: ${savedPath}
`;

                if (accountInfo.needsVerification) {
                    successMessage += `
⚠️ ACCOUNT VERIFICATION REQUIRED!
Check your email for a verification code from Facebook, then use:
fbcreator verify YOUR_CODE

Your account will be locked until verified.
`;
                } else {
                    successMessage += "✅ Account is ready to use!";
                }

                api.sendMessage(successMessage, event.threadID);
                return;
            }

            // If all methods failed, save partial account info
            api.sendMessage(`❌ Account creation completed with status: ${accountInfo.status || "Failed"}

${accountInfo.message || "Facebook may have rejected the registration attempt."}

Account information has been saved. You may need to complete the registration manually.`, event.threadID);

            savePartialAccountInfo(userData, email, emailPassword, accountInfo.cookies || {});

        } catch (error) {
            console.error('Error creating Facebook account:', error);
            api.sendMessage(`❌ An error occurred while creating the account: ${error.message}`, event.threadID, event.messageID);
        }
    },

    /**
     * Handle verification code for an account
     * @param {Object} api - Bot API object for sending messages
     * @param {Object} event - Event object containing threadID and messageID
     * @param {Array} args - Command arguments [verification_code]
     */
    async handleVerification(api, event, args) {
        if (args.length < 1) {
            api.sendMessage("❌ Please provide a verification code.\nUsage: fbcreator verify yourcode", event.threadID, event.messageID);
            return;
        }

        const verificationCode = args[0];

        // Find the most recent account file with needsVerification flag
        try {
            const accountsDir = path.join(__dirname, '../accounts');

            // Check if accounts directory exists
            if (!fs.existsSync(accountsDir)) {
                api.sendMessage("❌ No accounts directory found. Cannot perform verification.", event.threadID, event.messageID);
                return;
            }

            // Get all account info files
            const files = fs.readdirSync(accountsDir)
                .filter(file => file.includes('_info.json'))
                .map(file => ({
                    name: file,
                    path: path.join(accountsDir, file),
                    time: fs.statSync(path.join(accountsDir, file)).mtimeMs
                }))
                .sort((a, b) => b.time - a.time); // Sort newest first

            if (files.length === 0) {
                api.sendMessage("❌ No account files found. Create an account first.", event.threadID, event.messageID);
                return;
            }

            // Find the most recent account that needs verification
            let accountToVerify = null;
            let accountData = null;

            for (const file of files) {
                try {
                    const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
                    if (data.needsVerification) {
                        accountToVerify = file;
                        accountData = data;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!accountToVerify) {
                api.sendMessage("❌ No accounts found that need verification. If you have an account that needs verification, try creating a new one first.", event.threadID, event.messageID);
                return;
            }

            api.sendMessage(`🔄 Attempting to verify account for ${accountData.email}...`, event.threadID);

            // Create session and attempt verification
            const session = createEnhancedSession();

            // Restore cookies from the account
            if (accountData.cookies) {
                for (const [name, value] of Object.entries(accountData.cookies)) {
                    session.cookieJar[name] = value;
                }
            }

            const verificationResult = await verifyFacebookAccount(session, accountData, verificationCode);

            if (verificationResult.success) {
                // Update account file
                accountData.needsVerification = false;
                accountData.verified = true;
                accountData.verifiedTime = new Date().toISOString();
                if (verificationResult.userId) {
                    accountData.userId = verificationResult.userId;
                }
                if (verificationResult.cookies) {
                    accountData.cookies = verificationResult.cookies;
                }

                fs.writeFileSync(accountToVerify.path, JSON.stringify(accountData, null, 2));

                api.sendMessage(`✅ Account verified successfully!

You can now log in to Facebook with:
Email: ${accountData.email}
Password: ${accountData.fbPassword}

User ID: ${accountData.userId || "Unknown"}`, event.threadID);
            } else {
                api.sendMessage(`❌ Verification failed: ${verificationResult.message || "Unknown error"}

Try again with a different code or verify manually by logging in to Facebook with:
Email: ${accountData.email}
Password: ${accountData.fbPassword}`, event.threadID);
            }

        } catch (error) {
            console.error('Error during verification:', error);
            api.sendMessage(`❌ An error occurred during verification: ${error.message}`, event.threadID);
        }
    }
};

/**
 * Verify a Facebook account with a verification code
 * @param {Object} session - Session object
 * @param {Object} accountInfo - Account information
 * @param {string} code - Verification code
 * @returns {Object} Verification result
 */
async function verifyFacebookAccount(session, accountInfo, code) {
    try {
        // Create a client with extended timeout
        const client = axios.create({
            timeout: 30000,
            maxRedirects: 10,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
                keepAlive: true
            })
        });

        // First try to visit the checkpoint page
        console.log("Visiting checkpoint page with verification code...");

        // Potential verification URLs
        const verificationUrls = [
            'https://m.facebook.com/checkpoint/',
            'https://m.facebook.com/checkpoint/1501092823525282/',
            'https://m.facebook.com/login/checkpoint/',
            'https://m.facebook.com/confirmemail.php'
        ];

        let checkpointResponse = null;

        // Try each URL until we find one that works
        for (const url of verificationUrls) {
            try {
                checkpointResponse = await client.get(url, {
                    headers: session.getHeaders(false, 'https://m.facebook.com/')
                });
                session.updateCookies(checkpointResponse);

                // If we got a form, break the loop
                if (checkpointResponse.data && checkpointResponse.data.includes('name="code"')) {
                    console.log(`Found verification form at ${url}`);
                    break;
                }
            } catch (err) {
                console.log(`Error accessing ${url}: ${err.message}`);
                // Continue to the next URL
            }
        }

        // If we couldn't find a form, try a different approach
        if (!checkpointResponse || !checkpointResponse.data || !checkpointResponse.data.includes('name="code"')) {
            console.log("No verification form found. Trying direct submission...");

            // Try direct submission to common verification endpoints
            const directSubmissionUrls = [
                'https://m.facebook.com/checkpoint/submit/',
                'https://m.facebook.com/checkpoint/1501092823525282/submit/',
                'https://m.facebook.com/confirmemail.php',
                'https://m.facebook.com/confirm_email.php'
            ];

            for (const url of directSubmissionUrls) {
                try {
                    const formData = {
                        code: code,
                        fb_dtsg: session.fbDtsg || '',
                        jazoest: session.jazoest || '',
                        submit: 'Confirm'
                    };

                    const submitResponse = await client.post(url, querystring.stringify(formData), {
                        headers: session.getHeaders(true, 'https://m.facebook.com/')
                    });

                    session.updateCookies(submitResponse);

                    // Check if we got a c_user cookie or success indicators
                    if (session.cookieJar['c_user'] ||
                        (submitResponse.data && (
                            submitResponse.data.includes('success') ||
                            submitResponse.data.includes('home.php') ||
                            submitResponse.data.includes('welcome')))) {
                        console.log("Direct verification submission successful!");
                        return {
                            success: true,
                            userId: session.cookieJar['c_user'] || extractUserIdFromUrl(submitResponse.request?.res?.responseUrl || ''),
                            cookies: session.cookieJar
                        };
                    }
                } catch (err) {
                    console.log(`Error with ${url}: ${err.message}`);
                    // Continue to the next URL
                }
            }

            // If direct submission fails, try to log in with credentials
            console.log("Direct verification failed. Trying login...");

            const loginResult = await attemptLoginWithCredentials(client, session, accountInfo.email, accountInfo.fbPassword);
            if (loginResult.success) {
                console.log("Login successful after verification attempts!");
                return {
                    success: true,
                    userId: loginResult.userId,
                    cookies: session.cookieJar
                };
            }

            return {
                success: false,
                message: "Could not find verification form or direct submission failed."
            };
        }

        // Extract the verification form
        const $ = cheerio.load(checkpointResponse.data);
        const form = $('form').first();

        if (!form.length) {
            return {
                success: false,
                message: "No form found on verification page."
            };
        }

        // Get form action
        let formAction = form.attr('action') || 'https://m.facebook.com/checkpoint/submit/';
        if (!formAction.startsWith('http')) {
            formAction = `https://m.facebook.com${formAction}`;
        }

        // Extract form data
        const formData = {};
        form.find('input').each((i, el) => {
            const name = $(el).attr('name');
            const value = $(el).attr('value') || '';
            if (name) {
                formData[name] = value;
            }
        });

        // Add code and submit
        formData.code = code;
        formData.submit = 'Confirm';

        // Add tokens if available
        if (session.fbDtsg) formData.fb_dtsg = session.fbDtsg;
        if (session.lsd) formData.lsd = session.lsd;
        if (session.jazoest) formData.jazoest = session.jazoest;

        // Submit the form
        console.log(`Submitting verification code to ${formAction}...`);

        const verificationResponse = await client.post(
            formAction,
            querystring.stringify(formData),
            {
                headers: session.getHeaders(true, checkpointResponse.request?.res?.responseUrl || 'https://m.facebook.com/checkpoint/')
            }
        );

        // Update cookies
        session.updateCookies(verificationResponse);

        // Check for success indicators
        if (session.cookieJar['c_user']) {
            console.log(`Verification successful! User ID: ${session.cookieJar['c_user']}`);
            return {
                success: true,
                userId: session.cookieJar['c_user'],
                cookies: session.cookieJar
            };
        }

        // Check for redirect to successful pages
        const finalUrl = verificationResponse.request?.res?.responseUrl || '';
        if (finalUrl.includes('home.php') || finalUrl.includes('welcome') || finalUrl.includes('success')) {
            console.log(`Verification successful based on redirect to ${finalUrl}`);
            const userId = extractUserIdFromUrl(finalUrl) || session.cookieJar['c_user'];
            return {
                success: true,
                userId: userId || 'unknown',
                cookies: session.cookieJar
            };
        }

        // Handle multi-step verification
        if (verificationResponse.data && verificationResponse.data.includes('checkpoint')) {
            const nextCheckpointResponse = await client.get(finalUrl, {
                headers: session.getHeaders(false, formAction)
            });

            session.updateCookies(nextCheckpointResponse);

            // Check if this is another verification screen
            const next$ = cheerio.load(nextCheckpointResponse.data);
            const nextForm = next$('form').first();

            if (nextForm.length) {
                const nextFormAction = nextForm.attr('action') || 'https://m.facebook.com/checkpoint/submit/';
                const nextFormData = {};

                nextForm.find('input').each((i, el) => {
                    const name = next$(el).attr('name');
                    const value = next$(el).attr('value') || '';
                    if (name) {
                        nextFormData[name] = value;
                    }
                });

                // Look for a continue/submit button
                const submitButton = nextForm.find('button[type="submit"], input[type="submit"]').first();
                if (submitButton.length) {
                    const submitName = submitButton.attr('name');
                    const submitValue = submitButton.attr('value') || '1';
                    if (submitName) {
                        nextFormData[submitName] = submitValue;
                    }
                } else {
                    // Add a generic submit
                    nextFormData.submit = 'Continue';
                }

                // Add tokens if available
                if (session.fbDtsg) nextFormData.fb_dtsg = session.fbDtsg;
                if (session.lsd) nextFormData.lsd = session.lsd;
                if (session.jazoest) nextFormData.jazoest = session.jazoest;

                // Submit the next form
                console.log("Continuing to next verification step...");

                const nextStepResponse = await client.post(
                    nextFormAction.startsWith('http') ? nextFormAction : `https://m.facebook.com${nextFormAction}`,
                    querystring.stringify(nextFormData),
                    {
                        headers: session.getHeaders(true, finalUrl)
                    }
                );

                session.updateCookies(nextStepResponse);

                // Check for success
                if (session.cookieJar['c_user']) {
                    console.log(`Multi-step verification successful! User ID: ${session.cookieJar['c_user']}`);
                    return {
                        success: true,
                        userId: session.cookieJar['c_user'],
                        cookies: session.cookieJar
                    };
                }

                // Check final URL
                const finalStepUrl = nextStepResponse.request?.res?.responseUrl || '';
                if (finalStepUrl.includes('home.php') || finalStepUrl.includes('welcome') || finalStepUrl.includes('success')) {
                    console.log(`Multi-step verification successful based on redirect to ${finalStepUrl}`);
                    const userId = extractUserIdFromUrl(finalStepUrl) || session.cookieJar['c_user'];
                    return {
                        success: true,
                        userId: userId || 'unknown',
                        cookies: session.cookieJar
                    };
                }
            }
        }

        // If we get here, verification probably failed
        console.log("Verification process didn't yield expected results. Trying login as final check...");

        // Try logging in as a final check
        const loginResult = await attemptLoginWithCredentials(client, session, accountInfo.email, accountInfo.fbPassword);
        if (loginResult.success) {
            console.log("Login successful after verification!");
            return {
                success: true,
                userId: loginResult.userId,
                cookies: session.cookieJar
            };
        }

        return {
            success: false,
            message: "Verification code didn't work. Try another code or verify manually."
        };

    } catch (error) {
        console.error("Error during verification:", error.message);
        return {
            success: false,
            message: `Error during verification: ${error.message}`
        };
    }
}

/**
 * Multi-stage account creation that tries different approaches
 * @param {Object} session - Enhanced session object
 * @param {Object} userData - User data to register with
 * @param {string} email - Email address for registration
 * @param {Object} api - Bot API for sending messages
 * @param {Object} event - Event object containing threadID
 * @returns {Object} Result with account info
 */
async function createFacebookAccountMultiStage(session, userData, email, api, event) {
    try {
        // Use a more reliable sequencing of methods based on success rate

        // Mobile approach first - seems most reliable based on logs
        api.sendMessage(`🔄 Attempting account creation via mobile method (1/4)...`, event.threadID);
        console.log("Creating Facebook account with mobile approach...");
        const mobileResult = await createFacebookAccountOptimized(session, userData, email, 'mobile');

        if (mobileResult.success) {
            console.log("Mobile approach successful!");
            return mobileResult;
        }

        // Reset session cookies
        session.resetCookies();

        // API approach next
        api.sendMessage(`⚠️ Mobile method didn't succeed. Trying API method (2/4)...`, event.threadID);
        console.log("Creating Facebook account with API approach...");
        const apiResult = await createFacebookAccountOptimized(session, userData, email, 'api');

        if (apiResult.success) {
            console.log("API approach successful!");
            return apiResult;
        }

        // Reset session cookies
        session.resetCookies();

        // Desktop approach
        api.sendMessage(`⚠️ API method didn't succeed. Trying desktop method (3/4)...`, event.threadID);
        console.log("Creating Facebook account with desktop approach...");
        const desktopResult = await createFacebookAccountOptimized(session, userData, email, 'desktop');

        if (desktopResult.success) {
            console.log("Desktop approach successful!");
            return desktopResult;
        }

        // Reset session cookies
        session.resetCookies();

        // Direct approach as last resort
        api.sendMessage(`⚠️ Desktop method didn't succeed. Trying direct method (4/4)...`, event.threadID);
        console.log("Creating Facebook account with direct approach...");
        const directResult = await createFacebookAccountOptimized(session, userData, email, 'direct');

        if (directResult.success) {
            console.log("Direct approach successful!");
            return directResult;
        }

        // If all approaches failed but we have cookies, return a partial success
        if (mobileResult.cookies || apiResult.cookies || desktopResult.cookies || directResult.cookies) {
            const bestResult = [mobileResult, apiResult, desktopResult, directResult]
                .filter(result => result.cookies && Object.keys(result.cookies).length > 0)
                .reduce((best, current) => {
                    // Choose the result with the most cookies, preferring those with c_user
                    const bestCookieCount = Object.keys(best.cookies || {}).length;
                    const currentCookieCount = Object.keys(current.cookies || {}).length;

                    if (current.cookies && current.cookies.c_user) return current;
                    if (best.cookies && best.cookies.c_user) return best;

                    return currentCookieCount > bestCookieCount ? current : best;
                }, { cookies: {} });

            console.log("All approaches failed but returning partial success with cookies");
            return {
                success: true,
                needsVerification: true,
                status: "Verification Required",
                userId: bestResult.userId || null,
                cookies: bestResult.cookies || {}
            };
        }

        // If all failed with no cookies, return failure
        return {
            success: false,
            status: "Failed",
            message: "All account creation methods failed. Try with a different email."
        };

    } catch (error) {
        console.error("Error in multi-stage approach:", error.message);
        return {
            success: false,
            status: "Error",
            message: `Error: ${error.message}`
        };
    }
}

/**
 * Optimized account creation with different methods
 * @param {Object} session - Enhanced session object
 * @param {Object} userData - User data to register with
 * @param {string} email - Email address for registration
 * @param {string} method - Method to use (mobile, api, desktop, direct)
 * @returns {Object} Result of account creation attempt
 */
async function createFacebookAccountOptimized(session, userData, email, method) {
    try {
        // Create a client with improved security settings
        const client = axios.create({
            timeout: 30000,
            maxRedirects: 15,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
                keepAlive: true
            })
        });

        // Common form data for all methods
        const commonFormData = {
            firstname: userData.firstName,
            lastname: userData.lastName,
            reg_email__: email,
            reg_email_confirmation__: email,
            reg_passwd__: userData.password,
            birthday_day: String(userData.birthDay),
            birthday_month: String(userData.birthMonth),
            birthday_year: String(userData.birthYear),
            sex: userData.gender,
            locale: 'en_US',
            websubmit: '1',
            contactpoint_type: 'email',
            terms: 'on',
            ns: '0',
            application_locale: 'en_US',
            is_birthday_verified: 'true',
            birthday_age: String(2025 - userData.birthYear),
            timezone: '-480',
            device_id: session.deviceId,
            machine_id: session.machineId,
            guid: generateUUID().toUpperCase(),
        };

        let formAction, formData;

        // Method-specific preparation
        switch (method) {
            case 'mobile':
                // Warm up session
                await warmUpSession(client, session, 'mobile');

                // Get form data from registration page
                const mobileFormData = await getRegistrationFormData(client, session, 'mobile');
                if (!mobileFormData.formAction) {
                    console.log("Could not find mobile registration form");
                    return {
                        success: false,
                        error: "Mobile registration form not found",
                        cookies: session.cookieJar
                    };
                }

                formAction = mobileFormData.formAction;
                formData = {
                    ...mobileFormData.formData,
                    ...commonFormData,
                    referrer: 'mobile_fb',
                    reg_instance: generateUUID(),
                    platform: 'android',
                    flow_name: 'reg',
                    create_timestamp: String(Math.floor(Date.now() / 1000)),
                    ccp: '2',
                    had_cp_prefilled: '0',
                    had_password_prefilled: '0',
                    is_mobile_device: 'true'
                };
                break;

            case 'api':
                // Warm up session with basic requests
                await client.get('https://www.google.com/search?q=facebook+signup', {
                    headers: session.getHeaders()
                }).catch(err => console.log("Error during warmup:", err.message));

                await delay(1500, 3000);

                // Get tokens from Facebook homepage
                const tokenResponse = await client.get('https://m.facebook.com/', {
                    headers: session.getHeaders()
                }).catch(err => {
                    console.log("Error getting tokens:", err.message);
                    return { data: "", headers: {} };
                });

                session.updateCookies(tokenResponse);
                await delay(1500, 3000);

                formAction = 'https://m.facebook.com/reg/submit/';
                formData = {
                    ...commonFormData,
                    fb_dtsg: session.fbDtsg || '',
                    lsd: session.lsd || '',
                    jazoest: session.jazoest || '',
                    referrer: 'mobile_fb',
                    ccp: '2',
                    reg_instance: generateUUID(),
                    reg_impression_id: generateUUID(),
                    submission_request: 'true',
                    utm_source: '',
                    utm_medium: '',
                    utm_campaign: ''
                };
                break;

            case 'desktop':
                // Use desktop user agent
                session.userAgent = getRandomDesktopUserAgent();

                // Warm up session
                await warmUpSession(client, session, 'desktop');

                // Get form data from registration page
                const desktopFormData = await getRegistrationFormData(client, session, 'desktop');
                if (!desktopFormData.formAction) {
                    console.log("Could not find desktop registration form");
                    return {
                        success: false,
                        error: "Desktop registration form not found",
                        cookies: session.cookieJar
                    };
                }

                formAction = desktopFormData.formAction;
                formData = {
                    ...desktopFormData.formData,
                    ...commonFormData,
                    referrer: '',
                    reg_instance: generateUUID(),
                    logger_id: generateUUID(),
                    reg_impression_id: generateUUID(),
                    action_type: 'submit'
                };
                break;

            case 'direct':
                // Reset user agent
                session.userAgent = getRandomUserAgent();

                // Get tokens from homepage
                await client.get('https://www.facebook.com/', {
                    headers: session.getHeaders()
                }).catch(err => {
                    console.log("Error loading homepage:", err.message);
                    return { data: "", headers: {} };
                });

                formAction = 'https://www.facebook.com/ajax/register.php';
                formData = {
                    ...commonFormData,
                    email: email,
                    password: userData.password,
                    gender: userData.gender,
                    lsd: session.lsd || '',
                    jazoest: session.jazoest || '',
                    fb_dtsg: session.fbDtsg || '',
                    create: 'Create Account',
                    ref: 'dbl'
                };
                break;

            default:
                throw new Error(`Unknown method: ${method}`);
        }

        // Simulate human behavior
        await simulateHumanFormFilling();

        // Prepare headers based on method
        const headers = method === 'api' ?
            {
                ...session.getHeaders(true, 'https://m.facebook.com/reg/'),
                'X-ASBD-ID': '129477',
                'X-FB-LSD': session.lsd || '',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
                'X-FB-Friendly-Name': 'RegMobileCreateAccount'
            } :
            session.getHeaders(true, method === 'mobile' ?
                'https://m.facebook.com/reg/' :
                method === 'desktop' ?
                    'https://www.facebook.com/r.php' :
                    'https://www.facebook.com/');

        // Submit the form
        console.log(`Submitting ${method} registration form to ${formAction}...`);

        let registrationResponse;
        try {
            registrationResponse = await client.post(
                formAction,
                querystring.stringify(formData),
                { headers }
            );
            session.updateCookies(registrationResponse);
        } catch (err) {
            console.log(`Error submitting ${method} registration form:`, err.message);
            if (err.response) {
                registrationResponse = err.response;
                session.updateCookies(registrationResponse);
            } else {
                registrationResponse = { data: "", status: err.code || 500 };
            }
        }

        // Wait after submission
        await delay(3000, 5000);

        // Check for success indicators
        const cookies = session.cookieJar;

        // Debug: print important cookies
        console.log(`Cookies after ${method} registration:`);
        ['c_user', 'xs', 'fr', 'datr', 'sb'].forEach(cookieName => {
            if (cookies[cookieName]) {
                console.log(`  ${cookieName}: ${cookies[cookieName]}`);
            }
        });

        // Check for c_user cookie (strongest indicator of success)
        if (cookies["c_user"]) {
            console.log(`${method} registration successful! User ID: ${cookies['c_user']}`);
            return {
                success: true,
                userId: cookies['c_user'],
                cookies: cookies
            };
        }

        // Check for final URL indicating success
        let finalUrl = '';
        try {
            finalUrl = registrationResponse.request?.res?.responseUrl || '';
            console.log(`Final ${method} redirect URL: ${finalUrl}`);
        } catch (e) {
            console.log("Couldn't get final URL:", e.message);
        }

        if (finalUrl && (
            finalUrl.includes('checkpoint') ||
            finalUrl.includes('confirmemail') ||
            finalUrl.includes('confirmation') ||
            finalUrl.includes('welcome') ||
            finalUrl.includes('home.php') ||
            finalUrl.includes('save-device') ||
            finalUrl.includes('login_source=account_creation'))) {

            console.log(`${method} registration appears successful based on redirect: ${finalUrl}`);

            // Extract user ID if possible
            const userId = extractUserIdFromUrl(finalUrl);

            // Check if verification is needed
            const needsVerification = finalUrl.includes('checkpoint') ||
                finalUrl.includes('confirmemail') ||
                finalUrl.includes('confirmation') ||
                registrationResponse.data.includes('checkpoint') ||
                registrationResponse.data.includes('confirm') ||
                registrationResponse.data.includes('verify');

            return {
                success: true,
                needsVerification: needsVerification,
                userId: userId || 'unknown',
                cookies: cookies,
                redirectUrl: finalUrl
            };
        }

        // Check response data for verification indicators
        if (registrationResponse.data && typeof registrationResponse.data === 'string' && (
            registrationResponse.data.includes('checkpoint') ||
            registrationResponse.data.includes('confirmation') ||
            registrationResponse.data.includes('confirm') ||
            registrationResponse.data.includes('verify') ||
            registrationResponse.data.includes('confirm your email'))) {

            console.log(`${method} registration requires verification.`);
            return {
                success: true,
                needsVerification: true,
                cookies: cookies
            };
        }

        // Try login with credentials
        console.log(`${method} registration not clearly successful. Trying login...`);
        const loginResult = await attemptLoginWithCredentials(client, session, email, userData.password);

        if (loginResult.success) {
            console.log(`Login successful after ${method} registration!`);
            return {
                success: true,
                userId: loginResult.userId,
                cookies: session.cookieJar
            };
        }

        // Extract error messages if available
        let errorMessages = [];
        try {
            if (registrationResponse.data && typeof registrationResponse.data === 'string') {
                const errorParser = cheerio.load(registrationResponse.data);
                errorMessages = extractErrorMessages(errorParser);
            }
        } catch (e) {
            console.log("Error parsing response for errors:", e.message);
        }

        // If all else fails, return failure with the cookies we have
        return {
            success: false,
            error: errorMessages.length > 0 ? errorMessages[0] : `${method} registration failed with status ${registrationResponse.status}`,
            cookies: cookies
        };

    } catch (error) {
        console.error(`Error in ${method} account creation:`, error.message);
        return {
            success: false,
            error: `${method} method error: ${error.message}`,
            cookies: session.cookieJar
        };
    }
}

/**
 * Warm up session with natural browsing behavior
 * @param {Object} client - Axios client
 * @param {Object} session - Session object
 * @param {string} type - Session type (mobile, desktop)
 */
async function warmUpSession(client, session, type) {
    try {
        console.log(`Warming up ${type} session...`);

        // First visit Google to simulate coming from search
        await client.get(`https://www.google.com/search?q=facebook+signup+${type}`, {
            headers: session.getHeaders()
        }).catch(err => console.log("Error during Google warmup:", err.message));

        await delay(1500, 3000);

        // Visit Facebook homepage
        const baseUrl = type === 'mobile' ? 'https://m.facebook.com/' : 'https://www.facebook.com/';

        const homeResponse = await client.get(baseUrl, {
            headers: session.getHeaders(false, 'https://www.google.com/')
        }).catch(err => {
            console.log("Error visiting homepage:", err.message);
            return { data: "", headers: {} };
        });

        session.updateCookies(homeResponse);

        await delay(1000, 2000);

        // Visit login page to simulate regular browsing
        await client.get(`${baseUrl}login/`, {
            headers: session.getHeaders(false, baseUrl)
        }).catch(err => {
            console.log("Error visiting login page:", err.message);
            return { data: "", headers: {} };
        });

        await delay(1000, 2000);

    } catch (err) {
        console.log("Error during session warmup:", err.message);
    }
}

/**
 * Get registration form data
 * @param {Object} client - Axios client
 * @param {Object} session - Session object
 * @param {string} type - Form type (mobile, desktop)
 * @returns {Object} Form data and action URL
 */
async function getRegistrationFormData(client, session, type) {
    try {
        const urls = type === 'mobile' ? [
            'https://m.facebook.com/reg/',
            'https://m.facebook.com/reg/submit/',
            'https://m.facebook.com/join/',
            'https://m.facebook.com/signup',
            'https://m.facebook.com/r.php',
            'https://m.facebook.com/index.php?next=https%3A%2F%2Fm.facebook.com%2Freg%2F'
        ] : [
            'https://www.facebook.com/r.php',
            'https://www.facebook.com/reg/',
            'https://www.facebook.com/signup',
            'https://www.facebook.com/join',
            'https://www.facebook.com/?register'
        ];

        const baseUrl = type === 'mobile' ? 'https://m.facebook.com/' : 'https://www.facebook.com/';

        for (const url of urls) {
            try {
                console.log(`Trying ${type} registration URL: ${url}`);
                const response = await client.get(url, {
                    headers: session.getHeaders(false, baseUrl)
                });

                session.updateCookies(response);

                // Extract form data
                const formData = extractRegistrationFormData(response.data);
                if (Object.keys(formData).length > 3) { // If we found more than just a few fields
                    const formAction = extractFormAction(response.data) ||
                        (type === 'mobile' ? 'https://m.facebook.com/reg/submit/' : 'https://www.facebook.com/reg/submit/');

                    console.log(`Found ${type} registration form at ${url}`);
                    await delay(1000, 2000);

                    return {
                        formAction: formAction.startsWith('http') ? formAction : `${baseUrl}${formAction.startsWith('/') ? formAction.substring(1) : formAction}`,
                        formData
                    };
                }

                await delay(1000, 2000);
            } catch (err) {
                console.log(`Error accessing ${url}:`, err.message);
                // Continue with the next URL
            }
        }

        // If no form found on any URL, return empty data
        return {
            formAction: '',
            formData: {}
        };

    } catch (err) {
        console.log(`Error getting ${type} registration form:`, err.message);
        return {
            formAction: '',
            formData: {}
        };
    }
}

/**
 * Create an enhanced session with better anti-detection measures
 * @returns {Object} Session object with enhanced fingerprinting
 */
function createEnhancedSession() {
    // Create a unique device ID that will be consistent throughout the session
    const deviceId = generateUUID().toUpperCase();
    const machineId = generateUUID();

    // Generate random browser fingerprinting values
    const screenWidth = random.integer(1280, 1920);
    const screenHeight = random.integer(720, 1080);
    const dpr = random.pick([1, 1.5, 2, 2.5, 3]);
    const timezone = -480; // Pacific Time

    // Generate a unique Facebook-specific browser ID
    const browserId = `${random.integer(100000, 999999)}.${random.integer(100000, 999999)}`;

    // Create base cookies that help evade Facebook's bot detection
    const baseCookies = {
        'locale': 'en_US',
        'wd': `${screenWidth}x${screenHeight}`,
        'dpr': `${dpr}`,
        'datr': generateRandomCookieValue(24),
        'sb': generateRandomCookieValue(24),
        'fr': `${browserId}.${Math.floor(Date.now() / 1000)}.0.${Math.random()}`,
        'presence': `${random.integer(1000000, 9999999)}`,
        'c_user': '',
        'xs': ''
    };

    // Choose a realistic user agent
    const userAgent = getRandomUserAgent();

    return {
        deviceId,
        machineId,
        screenWidth,
        screenHeight,
        dpr,
        timezone,
        cookies: { ...baseCookies },
        userAgent,
        cookieJar: {},
        fbDtsg: '',
        lsd: '',
        jazoest: '',
        spin: '',

        // Reset cookies but keep fingerprinting
        resetCookies: function () {
            this.cookieJar = {};
            this.fbDtsg = '';
            this.lsd = '';
            this.jazoest = '';
            this.spin = '';

            // Regenerate base cookies
            this.cookies = {
                'locale': 'en_US',
                'wd': `${this.screenWidth}x${this.screenHeight}`,
                'dpr': `${this.dpr}`,
                'datr': generateRandomCookieValue(24),
                'sb': generateRandomCookieValue(24),
                'fr': `${browserId}.${Math.floor(Date.now() / 1000)}.0.${Math.random()}`,
                'presence': `${random.integer(1000000, 9999999)}`,
                'c_user': '',
                'xs': ''
            };
        },

        // Method to update cookies from response
        updateCookies: function (response) {
            try {
                if (response.headers && response.headers['set-cookie']) {
                    const setCookies = Array.isArray(response.headers['set-cookie'])
                        ? response.headers['set-cookie']
                        : [response.headers['set-cookie']];

                    for (const cookie of setCookies) {
                        const parts = cookie.split(';')[0].split('=');
                        if (parts.length === 2) {
                            const name = parts[0].trim();
                            const value = parts[1].trim();
                            if (value && value !== 'deleted') {
                                this.cookieJar[name] = value;

                                // Also update baseCookies if the cookie is one of them
                                if (name in this.cookies) {
                                    this.cookies[name] = value;
                                }
                            } else if (value === 'deleted' && this.cookieJar[name]) {
                                delete this.cookieJar[name];

                                // Also delete from baseCookies if the cookie is one of them
                                if (name in this.cookies) {
                                    this.cookies[name] = '';
                                }
                            }
                        }
                    }
                }

                // Try to extract DTSG and LSD tokens from response if available
                this.extractTokens(response);
            } catch (err) {
                console.error("Error updating cookies:", err);
            }
        },

        // Method to convert cookies to string for headers
        getCookieString: function () {
            return Object.entries(this.cookieJar)
                .filter(([_, value]) => value !== '')
                .map(([key, value]) => `${key}=${value}`)
                .join('; ');
        },

        // Method to extract Facebook tokens from response
        extractTokens: function (response) {
            try {
                if (response.data && typeof response.data === 'string') {
                    // Extract fb_dtsg token
                    const dtsgMatch = response.data.match(/"fb_dtsg":"([^"]+)"/);
                    if (dtsgMatch) {
                        this.fbDtsg = dtsgMatch[1];
                    }

                    // Also try alternate pattern
                    const dtsgAltMatch = response.data.match(/name="fb_dtsg" value="([^"]+)"/);
                    if (dtsgAltMatch && !this.fbDtsg) {
                        this.fbDtsg = dtsgAltMatch[1];
                    }

                    // Extract LSD token
                    const lsdMatch = response.data.match(/name="lsd" value="([^"]+)"/);
                    if (lsdMatch) {
                        this.lsd = lsdMatch[1];
                    }

                    // Alternate LSD pattern
                    const lsdAltMatch = response.data.match(/"LSD",\[\],{"token":"([^"]+)"/);
                    if (lsdAltMatch && !this.lsd) {
                        this.lsd = lsdAltMatch[1];
                    }

                    // Extract jazoest token
                    const jazoestMatch = response.data.match(/name="jazoest" value="([^"]+)"/);
                    if (jazoestMatch) {
                        this.jazoest = jazoestMatch[1];
                    }

                    // Extract __spin_r and __spin_t
                    const spinRMatch = response.data.match(/"__spin_r":([0-9]+)/);
                    const spinTMatch = response.data.match(/"__spin_t":([0-9]+)/);
                    if (spinRMatch && spinTMatch) {
                        this.spin = `r:${spinRMatch[1]},t:${spinTMatch[1]}`;
                    }
                }
            } catch (error) {
                console.error("Error extracting tokens:", error);
            }
        },

        // Create common headers for requests
        getHeaders: function (isPost = false, referer = null) {
            const headers = {
                'User-Agent': this.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
                'Sec-Ch-Ua': '"Google Chrome";v="113", "Chromium";v="113", "Not-A.Brand";v="24"',
                'Sec-Ch-Ua-Mobile': '?1',
                'Sec-Ch-Ua-Platform': '"Android"',
                'Dnt': '1'
            };

            if (referer) {
                headers['Referer'] = referer;
            } else {
                headers['Referer'] = 'https://www.google.com/';
            }

            // Add cookies if available
            const cookieString = this.getCookieString();
            if (cookieString) {
                headers['Cookie'] = cookieString;
            }

            // Add content type for POST requests
            if (isPost) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            // Add Facebook-specific headers
            if (this.fbDtsg) {
                headers['X-FB-DTSG'] = this.fbDtsg;
            }

            if (this.lsd) {
                headers['X-FB-LSD'] = this.lsd;
            }

            headers['X-ASBD-ID'] = '129477';
            headers['X-FB-Connection-Type'] = 'MOBILE_UNKNOWN';
            headers['X-FB-Connection-Quality'] = 'EXCELLENT';
            headers['X-FB-Connection-Bandwidth'] = String(random.integer(5000000, 10000000));
            headers['X-FB-Device-Group'] = String(random.integer(1000, 9999));

            return headers;
        }
    };
}

/**
 * Attempt to log in with the created credentials
 * @param {Object} client - Axios client
 * @param {Object} session - Session object with cookies
 * @param {string} email - Email to log in with
 * @param {string} password - Password to log in with
 * @returns {Object} Login result
 */
async function attemptLoginWithCredentials(client, session, email, password) {
    try {
        console.log("Attempting to log in with credentials...");

        // Wait a bit before login attempt
        await delay(3000, 5000);

        // First visit login page to get form and tokens
        const loginPageResponse = await client.get('https://m.facebook.com/login/', {
            headers: session.getHeaders(false, 'https://m.facebook.com/')
        }).catch(err => {
            console.log("Error loading login page:", err.message);
            return { data: "", headers: {} };
        });

        session.updateCookies(loginPageResponse);

        // Try to extract a form from the response
        const formData = extractLoginFormData(loginPageResponse.data, email, password);
        if (Object.keys(formData).length === 0) {
            console.log("No login form found");
            return { success: false };
        }

        // Add tokens if available
        if (session.fbDtsg) formData.fb_dtsg = session.fbDtsg;
        if (session.lsd) formData.lsd = session.lsd;
        if (session.jazoest) formData.jazoest = session.jazoest;

        // Standard login fields
        formData.locale = 'en_US';
        formData.login = '1';
        formData.persistent = '1'; // Keep logged in

        // Extract form action URL
        const formAction = extractFormAction(loginPageResponse.data, 'login') || 'https://m.facebook.com/login/device-based/regular/login/';

        // Simulate human behavior
        await delay(2000, 3000);

        // Submit login form
        console.log("Submitting login form...");
        let loginResponse;
        try {
            loginResponse = await client.post(
                formAction.startsWith('http') ? formAction : `https://m.facebook.com${formAction}`,
                querystring.stringify(formData),
                {
                    headers: session.getHeaders(true, 'https://m.facebook.com/login/')
                }
            );
            session.updateCookies(loginResponse);
        } catch (err) {
            console.log("Error during login attempt:", err.message);
            if (err.response) {
                loginResponse = err.response;
                session.updateCookies(loginResponse);
            } else {
                return { success: false };
            }
        }

        // Wait a bit after login attempt
        await delay(3000, 5000);

        // Check for c_user cookie
        const cookies = session.cookieJar;

        if (cookies['c_user']) {
            console.log(`Login successful! User ID: ${cookies['c_user']}`);
            return {
                success: true,
                userId: cookies['c_user'],
                cookies: cookies
            };
        }

        // Check for success based on URL
        let finalUrl = '';
        try {
            finalUrl = loginResponse.request?.res?.responseUrl || '';
            console.log(`Final login redirect URL: ${finalUrl}`);
        } catch (e) {
            console.log("Couldn't get final URL:", e.message);
        }

        if (finalUrl && (
            finalUrl.includes('home.php') ||
            finalUrl.includes('feed') ||
            finalUrl.includes('welcome') ||
            finalUrl.includes('save-device') ||
            finalUrl.includes('/ig/') // Instagram integration
        )) {
            console.log("Login successful based on redirect URL!");

            // Try to extract user ID from URL
            const userId = extractUserIdFromUrl(finalUrl);

            return {
                success: true,
                userId: userId || 'unknown',
                cookies: cookies
            };
        }

        // Try an alternative login endpoint if standard endpoint fails
        try {
            console.log("Trying alternative login endpoint...");

            // Create a simplified form with just email/password
            const simpleForm = {
                email: email,
                pass: password,
                login: '1',
                persistent: '1'
            };

            const altResponse = await client.post(
                'https://m.facebook.com/login.php',
                querystring.stringify(simpleForm),
                {
                    headers: session.getHeaders(true, 'https://m.facebook.com/')
                }
            );

            session.updateCookies(altResponse);

            // Check for c_user cookie again
            if (session.cookieJar['c_user']) {
                console.log(`Alternative login successful! User ID: ${session.cookieJar['c_user']}`);
                return {
                    success: true,
                    userId: session.cookieJar['c_user'],
                    cookies: session.cookieJar
                };
            }

            // Check redirect URL
            try {
                const altFinalUrl = altResponse.request?.res?.responseUrl || '';
                if (altFinalUrl && (
                    altFinalUrl.includes('home.php') ||
                    altFinalUrl.includes('feed') ||
                    altFinalUrl.includes('welcome'))) {
                    console.log("Alternative login successful based on redirect URL!");

                    return {
                        success: true,
                        userId: extractUserIdFromUrl(altFinalUrl) || 'unknown',
                        cookies: session.cookieJar
                    };
                }
            } catch (e) {
                console.log("Couldn't analyze alternative login response:", e.message);
            }
        } catch (err) {
            console.log("Error in alternative login:", err.message);
        }

        console.log("Login attempt failed");
        return { success: false };

    } catch (error) {
        console.error("Error during login attempt:", error.message);
        return { success: false };
    }
}

/**
 * Extract form action URL from HTML content
 * @param {string} html - HTML content containing the form
 * @param {string} formType - Type of form (registration, login)
 * @returns {string} Form action URL or empty string if not found
 */
function extractFormAction(html, formType = 'registration') {
    try {
        if (!html) return '';

        const $ = cheerio.load(html);

        let form;
        if (formType === 'registration') {
            form = $('form[id="mobile-reg-form"], form[id="signup-form"], form[action*="/reg/submit/"], form[id="reg"], form[id="registration_form"], form[action*="/reg/"]').first();
        } else if (formType === 'login') {
            form = $('form[id="login_form"], form[action*="/login/"], form[action*="login.php"]').first();
        }

        if (form && form.length) {
            const action = form.attr('action');
            return action || '';
        }

        return '';
    } catch (err) {
        console.log(`Error extracting form action:`, err.message);
        return '';
    }
}

/**
 * Extract registration form data from HTML content
 * @param {string} html - HTML content containing the form
 * @returns {Object} Form data object
 */
function extractRegistrationFormData(html) {
    try {
        if (!html) return {};

        const $ = cheerio.load(html);

        // Try to find the registration form
        const regFormSelectors = [
            'form[id="mobile-reg-form"]',
            'form[id="signup-form"]',
            'form[action*="/reg/submit/"]',
            'form[id="reg"]',
            'form[id="registration_form"]',
            'form[action*="/reg/"]',
            'form[name="reg"]',
            'form:contains("Create a new account")'
        ];

        let regForm = null;
        for (const selector of regFormSelectors) {
            const form = $(selector);
            if (form.length) {
                regForm = form;
                break;
            }
        }

        // If no form found, try a more general approach
        if (!regForm) {
            // Find forms that have keywords in their content
            $('form').each(function () {
                const formText = $(this).text().toLowerCase();
                if (formText.includes('create') ||
                    formText.includes('signup') ||
                    formText.includes('register') ||
                    formText.includes('join') ||
                    formText.includes('birthday')) {
                    regForm = $(this);
                    return false; // Break the loop
                }
            });
        }

        // If still no form found, return empty
        if (!regForm) {
            return {};
        }

        // Extract all input fields and their values
        const formData = {};
        regForm.find('input').each(function () {
            const name = $(this).attr('name');
            const value = $(this).attr('value') || '';
            if (name) {
                formData[name] = value;
            }
        });

        // Extract token information from scripts
        const scriptContent = html.toString();

        // Common token patterns
        const tokenPatterns = {
            lsd: /"lsd":"([^"]+)"|name="lsd" value="([^"]+)"/,
            fb_dtsg: /"fb_dtsg":"([^"]+)"|name="fb_dtsg" value="([^"]+)"/,
            jazoest: /name="jazoest" value="([^"]+)"/,
            spin_r: /"__spin_r":([0-9]+)/,
            spin_t: /"__spin_t":([0-9]+)/,
            datr: /"_datr":"([^"]+)"/
        };

        // Extract tokens and add to form data
        for (const [tokenName, pattern] of Object.entries(tokenPatterns)) {
            const match = scriptContent.match(pattern);
            if (match) {
                formData[tokenName] = match[1] || match[2] || '';
            }
        }

        return formData;
    } catch (err) {
        console.log(`Error extracting registration form data:`, err.message);
        return {};
    }
}

/**
 * Extract login form data from HTML content
 * @param {string} html - HTML content containing the form
 * @param {string} email - Email address
 * @param {string} password - Password
 * @returns {Object} Form data object
 */
function extractLoginFormData(html, email, password) {
    try {
        if (!html) return {};

        const $ = cheerio.load(html);

        // Try to find the login form
        const loginFormSelectors = [
            'form[id="login_form"]',
            'form[action*="/login/"]',
            'form[action*="login.php"]',
            'form:contains("Log In")',
            'form:contains("Sign In")'
        ];

        let loginForm = null;
        for (const selector of loginFormSelectors) {
            const form = $(selector);
            if (form.length) {
                loginForm = form;
                break;
            }
        }

        // If no form found, try a more general approach
        if (!loginForm) {
            // Find forms that have keywords in their content
            $('form').each(function () {
                const formText = $(this).text().toLowerCase();
                if (formText.includes('login') ||
                    formText.includes('log in') ||
                    formText.includes('sign in')) {
                    loginForm = $(this);
                    return false; // Break the loop
                }
            });
        }

        // If still no form found, create a minimal form data object
        if (!loginForm) {
            return {
                email: email,
                pass: password,
                login: '1'
            };
        }

        // Extract all input fields and their values
        const formData = {};
        loginForm.find('input').each(function () {
            const name = $(this).attr('name');
            const value = $(this).attr('value') || '';
            if (name) {
                formData[name] = value;
            }
        });

        // Look for email and password fields
        const emailFields = ['email', 'username', 'login', 'identity'];
        let emailFieldFound = false;

        for (const field of emailFields) {
            if (formData[field] !== undefined) {
                formData[field] = email;
                emailFieldFound = true;
                break;
            }
        }

        if (!emailFieldFound) {
            // Find anything that could be an email field
            for (const field in formData) {
                if (field.toLowerCase().includes('email') ||
                    field.toLowerCase().includes('user') ||
                    field.toLowerCase().includes('login')) {
                    formData[field] = email;
                    emailFieldFound = true;
                    break;
                }
            }

            // If still not found, add it explicitly
            if (!emailFieldFound) {
                formData.email = email;
            }
        }

        // Look for password field
        const passwordFields = ['pass', 'password', 'passwd'];
        let passwordFieldFound = false;

        for (const field of passwordFields) {
            if (formData[field] !== undefined) {
                formData[field] = password;
                passwordFieldFound = true;
                break;
            }
        }

        if (!passwordFieldFound) {
            // Find anything that could be a password field
            for (const field in formData) {
                if (field.toLowerCase().includes('pass')) {
                    formData[field] = password;
                    passwordFieldFound = true;
                    break;
                }
            }

            // If still not found, add it explicitly
            if (!passwordFieldFound) {
                formData.pass = password;
            }
        }

        return formData;
    } catch (err) {
        console.log(`Error extracting login form data:`, err.message);
        return {
            email: email,
            pass: password,
            login: '1'
        };
    }
}

/**
 * Extract error messages from HTML
 * @param {Object} $ - Cheerio object
 * @returns {Array} Array of error messages
 */
function extractErrorMessages($) {
    try {
        const errorMessages = [];

        // Check various error selectors that Facebook might use
        const errorSelectors = [
            '.errorMessage',
            '.error',
            '.errorContent',
            '#error',
            'div[role="alert"]',
            '.UIMessageBox',
            'div[class*="error"]',
            'div.uiHeader ~ div',  // Common error container
            '#globalContainer div.pam'  // Another error container
        ];

        // Look for error messages
        for (const selector of errorSelectors) {
            $(selector).each((i, el) => {
                const message = $(el).text().trim();
                if (message && !errorMessages.includes(message)) {
                    errorMessages.push(message);
                }
            });
        }

        // Also look for paragraphs with error keywords
        const errorKeywords = ['error', 'invalid', 'cannot', 'failed', 'not available', 'try again', 'problem'];

        $('p, div').each((i, el) => {
            const text = $(el).text().trim().toLowerCase();
            if (errorKeywords.some(keyword => text.includes(keyword)) &&
                !errorMessages.includes($(el).text().trim())) {
                errorMessages.push($(el).text().trim());
            }
        });

        return errorMessages;
    } catch (err) {
        console.log("Error extracting error messages:", err.message);
        return [];
    }
}

/**
 * Extract user ID from URL
 * @param {string} url - URL to extract ID from
 * @returns {string|null} User ID or null if not found
 */
function extractUserIdFromUrl(url) {
    if (!url) return null;

    // Common patterns for user ID in URLs
    const patterns = [
        /user=(\d+)/,
        /uid=(\d+)/,
        /id=(\d+)/,
        /profile\.php\?id=(\d+)/,
        /\/(\d{8,})\//,
        /shbid=(\d+)/,
        /userid=(\d+)/,
        /c_user=(\d+)/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return match[1];
        }
    }

    return null;
}

/**
 * Save account information to file
 * @param {Object} userData - User data
 * @param {string} email - Email address
 * @param {string} emailPassword - Email password
 * @param {Object} result - Result of account creation
 * @returns {string} Path to saved file
 */
function saveAccountInfo(userData, email, emailPassword, result) {
    try {
        // Create accounts directory if it doesn't exist
        const accountsDir = path.join(__dirname, '../accounts');
        fs.ensureDirSync(accountsDir);

        // Create account info object
        const accountInfo = {
            success: result.success,
            userId: result.userId || 'unknown',
            firstName: userData.firstName,
            lastName: userData.lastName,
            fullName: `${userData.firstName} ${userData.lastName}`,
            email: email,
            emailPassword: emailPassword || '',
            fbPassword: userData.password,
            gender: userData.gender === "1" ? "Female" : "Male",
            birthDate: `${userData.birthMonth}/${userData.birthDay}/${userData.birthYear}`,
            creationTime: new Date().toISOString(),
            needsVerification: result.needsVerification || false,
            cookies: result.cookies || {},
            lastUpdated: new Date().toISOString()
        };

        // Save cookies to file
        const cookiesFileName = `fb_account_${result.userId || 'new'}_${Date.now()}_cookies.json`;
        const cookiesFilePath = path.join(accountsDir, cookiesFileName);

        fs.writeFileSync(cookiesFilePath, JSON.stringify(result.cookies || {}, null, 2));
        console.log(`Cookies saved to ${cookiesFilePath}`);

        // Save account info to file
        const fileName = `fb_account_${result.userId || 'new'}_${Date.now()}_info.json`;
        const filePath = path.join(accountsDir, fileName);

        fs.writeFileSync(filePath, JSON.stringify(accountInfo, null, 2));
        console.log(`Account information saved to ${filePath}`);

        return filePath;
    } catch (error) {
        console.error('Error saving account information:', error);

        // Try to save to a simpler path in case of path issues
        try {
            const fileName = `fb_account_${Date.now()}.json`;
            fs.writeFileSync(fileName, JSON.stringify({
                email: email,
                password: userData.password,
                cookies: result.cookies || {}
            }, null, 2));

            return fileName;
        } catch (e) {
            console.error('Failed to save backup file:', e);
            return 'Failed to save';
        }
    }
}

/**
 * Save partial account information to file (when account creation isn't fully successful)
 * @param {Object} userData - User data
 * @param {string} email - Email address
 * @param {string} emailPassword - Email password
 * @param {Object} cookies - Cookies from the attempt
 * @returns {boolean} Success status
 */
function savePartialAccountInfo(userData, email, emailPassword, cookies) {
    try {
        // Create accounts directory if it doesn't exist
        const accountsDir = path.join(__dirname, '../accounts');
        fs.ensureDirSync(accountsDir);

        // Generate a random ID for partial accounts
        const randomId = Math.random().toString(36).substring(2, 10);

        // Create account info object
        const accountInfo = {
            success: false,
            partial: true,
            firstName: userData.firstName,
            lastName: userData.lastName,
            fullName: `${userData.firstName} ${userData.lastName}`,
            email: email,
            emailPassword: emailPassword || '',
            fbPassword: userData.password,
            gender: userData.gender === "1" ? "Female" : "Male",
            birthDate: `${userData.birthMonth}/${userData.birthDay}/${userData.birthYear}`,
            creationTime: new Date().toISOString(),
            cookies: cookies || {},
            lastUpdated: new Date().toISOString()
        };

        // Save account info to file
        const fileName = `fb_account_partial_${randomId}_${Date.now()}.json`;
        const filePath = path.join(accountsDir, fileName);

        fs.writeFileSync(filePath, JSON.stringify(accountInfo, null, 2));
        console.log(`Partial account information saved to ${filePath}`);

        return true;
    } catch (error) {
        console.error('Error saving partial account information:', error);
        return false;
    }
}

/**
 * Generate a random user data for account creation
 * @returns {Object} User data object
 */
function generateUserData() {
    // First names by gender
    const maleNames = [
        "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph",
        "Thomas", "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Mark",
        "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin", "Brian",
        "George", "Timothy", "Ronald", "Jason", "Edward", "Jeffrey", "Ryan", "Jacob",
        "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin", "Scott",
        "Brandon", "Benjamin", "Samuel", "Gregory", "Alexander", "Patrick", "Frank",
        "Raymond", "Jack", "Dennis", "Jerry", "Tyler", "Aaron", "Henry", "Douglas", "Adam"
    ];

    const femaleNames = [
        "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan",
        "Jessica", "Sarah", "Karen", "Lisa", "Nancy", "Betty", "Sandra", "Margaret",
        "Ashley", "Kimberly", "Emily", "Donna", "Michelle", "Carol", "Amanda", "Dorothy",
        "Melissa", "Deborah", "Stephanie", "Rebecca", "Laura", "Sharon", "Cynthia",
        "Kathleen", "Amy", "Angela", "Shirley", "Anna", "Ruth", "Brenda", "Pamela",
        "Nicole", "Katherine", "Virginia", "Catherine", "Christine", "Samantha", "Debra",
        "Janet", "Rachel", "Carolyn", "Emma", "Maria", "Heather", "Diane", "Julie"
    ];

    // Last names
    const lastNames = [
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
        "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
        "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
        "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
        "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
        "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
        "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
        "Carter", "Roberts", "Phillips", "Evans", "Turner", "Parker", "Collins"
    ];

    // Gender (1 = female, 2 = male)
    const gender = random.bool() ? "1" : "2";

    // Choose name based on gender
    const firstName = gender === "1"
        ? femaleNames[random.integer(0, femaleNames.length - 1)]
        : maleNames[random.integer(0, maleNames.length - 1)];

    // Choose last name
    const lastName = lastNames[random.integer(0, lastNames.length - 1)];

    // Generate birth date (25-50 years old)
    const currentYear = new Date().getFullYear();
    const birthYear = random.integer(currentYear - 50, currentYear - 25);
    const birthMonth = random.integer(1, 12);
    const birthDay = random.integer(1, daysInMonth(birthMonth, birthYear));

    // Generate password
    const password = generateStrongPassword(12);

    return {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        birthYear,
        birthMonth,
        birthDay,
        gender,
        password,
        locale: "en_US",
        timezone: "-480" // Pacific Time
    };
}

/**
 * Simulate human-like form filling behavior
 * @returns {Promise<void>} Promise that resolves after delays
 */
async function simulateHumanFormFilling() {
    // Simulate reading form before filling
    await delay(2000, 4000);

    // Simulate typing and field navigation with random pauses
    for (let i = 0; i < 6; i++) {  // For each form field
        // Simulate typing
        await delay(1000, 3000);

        // Simulate pause between fields
        await delay(500, 1500);
    }

    // Simulate reviewing form before submission
    await delay(2000, 4000);

    // Simulate final pause before clicking submit
    await delay(1000, 2000);
}

/**
 * Generate a strong random password
 * @param {number} length - Password length
 * @returns {string} Generated password
 */
function generateStrongPassword(length = 12) {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const special = '!@#$%^&*()_+-=';

    // Ensure at least one character from each set
    const password = [
        lowercase.charAt(Math.floor(Math.random() * lowercase.length)),
        uppercase.charAt(Math.floor(Math.random() * uppercase.length)),
        digits.charAt(Math.floor(Math.random() * digits.length)),
        special.charAt(Math.floor(Math.random() * special.length))
    ];

    // Fill the remaining length with random characters
    const allChars = lowercase + uppercase + digits + special;
    for (let i = password.length; i < length; i++) {
        password.push(allChars.charAt(Math.floor(Math.random() * allChars.length)));
    }

    // Shuffle the password characters
    for (let i = password.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [password[i], password[j]] = [password[j], password[i]];
    }

    // Convert array to string
    return password.join('');
}

/**
 * Generate a UUID (used for Facebook registration)
 * @returns {string} Generated UUID
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Generate a random cookie value
 * @param {number} length - Cookie value length
 * @returns {string} Generated cookie value
 */
function generateRandomCookieValue(length = 24) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
}

/**
 * Calculate days in a month (accounting for leap years)
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {number} Number of days in the month
 */
function daysInMonth(month, year) {
    return new Date(year, month, 0).getDate();
}

/**
 * Random delay function
 * @param {number} min - Minimum milliseconds
 * @param {number} max - Maximum milliseconds
 * @returns {Promise<void>} Promise that resolves after the delay
 */
function delay(min, max) {
    const ms = random.integer(min, max);
    console.log(`Waiting ${ms}ms...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get a random mobile user agent
 * @returns {string} Mobile user agent string
 */
function getRandomUserAgent() {
    const userAgents = [
        // iPhone
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/113.0.5672.109 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.1 Mobile/15E148 Safari/604.1",

        // Android
        "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 12; SM-G998U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 12; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",

        // Facebook App User Agents
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,3;FBMD/iPhone;FBSN/iOS;FBSV/16.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
        "Mozilla/5.0 (Linux; Android 13; SM-S908B Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/412.0.0.22.115;]",
    ];

    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * Get a random desktop user agent
 * @returns {string} Desktop user agent string
 */
function getRandomDesktopUserAgent() {
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36",
    ];

    return userAgents[Math.floor(Math.random() * userAgents.length)];
}