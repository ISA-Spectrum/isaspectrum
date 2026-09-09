![LOGO](./images/web-app-manifest-512x512.png)

Language：English | [简体中文](./README.zh-CN.md)



# ISA Spectrum
The ISA Wuhan Campus Community Platform

## About The Project
ISA Spectrum is a campus community website designed exclusively for **ISA Wuhan**. It serves as an online platform for information exchange and community interaction, connecting students, teachers, and all members of the ISA community.
The project adopts a lightweight, cloud-native architecture built with pure frontend technologies and **Supabase** as the backend service.

## Key Features
- Browse and display campus community content
- The "Campus Wall" for open discussion and communication
- User data and content storage (powered by Supabase Database)
- Fully responsive design, supporting both desktop and mobile access
- Community announcements and information updates

## Built With
- Frontend: HTML, CSS, JavaScript
- Backend / Database: Supabase
- Deployment: Cloudflare Pages

## Getting Started Locally
1. Clone the repository to your local machine
2. Configure your Supabase environment settings
3. Open the project using a local server (recommended)
4. Access the project via `index.html` to start

## Database Feature Setup

Run `supabase/community_features.sql` in the Supabase SQL Editor. It adds and migrates the real campus-wall `zone` column, creates the email-safe public homepage feed, and enables account-bound daily meal ratings with RLS.

## MFA Setup
1. Enable TOTP under Authentication → Multi-Factor Authentication in Supabase
2. Run `supabase/mfa_security.sql` in the Supabase SQL Editor
3. Add both `has_aal2()` and `is_checker()` to the existing RLS policies for moderation data, contact emails, and administrative mutations

Users can manage authenticators from `security.html`. Reviewers must enroll and complete MFA before entering the moderation area. Additional MFA methods can be registered through `registerProvider()` in `auth-mfa.js`.

## Project Structure
- `index.html` – Splash/Loading page
- `main.html` – Main community homepage
- `notice.html` – Site announcements page
- `messages.html` – Campus Wall discussion page
- `details.html` – Post details page
- `about.html` – Team introduction page
- `contact.html` – Contact information
- `download.html` – Client download service
- `login.html` – Campus Wall login page
- `security.html` – Two-factor authentication settings
- `mfa-setup.html` – Authenticator enrollment
- `mfa-challenge.html` – One-time-code challenge
- `register.html` – Campus Wall registration page
- `forgot-password.html` – Password recovery page
- `header.html` – Shared navigation bar
- `footer.html` – Shared footer
- `common.css` – Global stylesheet
- `common.js` – Shared utility functions
- `images/` – Image and resource folder
- Supabase – Backend data support
(Admin management pages are omitted here as they are not used by end users)

## Contributing
Contributions are welcome from all ISA members and developers!
1. Fork the repository
2. Create your feature branch
3. Commit and push your changes
4. Submit a Pull Request

## License
This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
