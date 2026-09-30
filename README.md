![LOGO](./images/web-app-manifest-512x512.png)

Language：English | [简体中文](./README.zh-CN.md)



# ISA Spectrum
The ISA Wuhan Campus Community Platform

## About The Project
ISA Spectrum is a campus community website designed exclusively for **ISA Wuhan**. It serves as an online platform for information exchange and community interaction, connecting students, teachers, and all members of the ISA community.
The project uses a static frontend, Cloudflare Pages Functions, and a business Supabase database. Authentication is delegated to an independent OpenID Provider; this site owns only business identity mappings and business sessions.

## Key Features
- Browse and display campus community content
- The "Campus Wall" for open discussion and communication
- User data and content storage (powered by Supabase Database)
- Fully responsive design, supporting both desktop and mobile access
- Community announcements and information updates

## Built With
- Frontend: HTML, CSS, JavaScript
- Backend: Cloudflare Pages Functions
- Database: Supabase for business data
- Authentication: OAuth 2.0 Authorization Code + PKCE / OpenID Connect
- Deployment: Cloudflare Pages

## Getting Started Locally
1. Clone the repository to your local machine
2. Copy `.dev.vars.example` to `.dev.vars` and configure OIDC plus the business database
3. Run `supabase/oidc_client.sql` in the business Supabase project
4. Start with a Cloudflare Pages Functions local runtime; a static-only server cannot run authentication
5. Run `npm test` and `npm run check`

## Database Feature Setup

Run `supabase/community_features.sql` in the Supabase SQL Editor. It adds and migrates the real campus-wall `zone` column and its safe projection, and prepares daily meal ratings. The OIDC cutover migration removes browser roles from these business records and routes access through Pages Functions.

## OAuth / OIDC

The business site is an OAuth/OIDC Client. Passwords, Passkeys, OTP, recovery codes, and MFA remain entirely inside the Authorization Server. The business site never treats the provider access token as its session. See the [business-side OIDC implementation guide](./docs/OIDC_CLIENT.zh-CN.md).

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
- `functions/auth/` – OAuth/OIDC and business-session routes
- `functions/api/` – business-session protected APIs
- `auth-client.js` – token-free browser session helper
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
