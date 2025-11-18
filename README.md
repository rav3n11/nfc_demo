This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

1. Install dependencies

```bash
npm install
```

2. Create a `.env.local` in the project root and add your Chapa secret key:

```bash
CHAPA_SECRET_KEY=live_or_test_secret_here
```

3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with Chrome on an NFC-capable Android device to demo the end-to-end flow. The landing page lives in `src/app/page.tsx`.

## Features

- Reads and writes NFC cards using the Web NFC API (Android Chrome only).
- Initializes 1 ETB payments through Chapa and preloads the new balance once the checkout opens.
- Mobile-first UI inspired by the Post Office customer portal branding.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
