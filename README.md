



# Discern

**A decision engine for fashion.**

Discern helps people decide what to buy instead of making them search through endless products, reviews, and comparisons.

> **The internet solved finding. It never solved deciding.**

## What is Discern?

Shopping today is built around search, filters, rankings, and endless browsing. That works when you already know what you're looking for. But when you're unsure, you have to do the research yourself.

Discern takes a different approach.

You describe what you're looking for in natural language, and Discern understands your needs, reasons across products, considers the relevant trade-offs, and recommends the options that best fit your situation.

Instead of:

**Search → Browse → Compare → Decide**

Discern aims for:

**Describe → Reason → Decide**

## How it works

1. **Describe what you need**  
   Tell Discern what you're looking for, including your budget, preferences, use case, style, or other requirements.

2. **Understand your intent**  
   Discern interprets the request and identifies the factors that matter to your decision.

3. **Reason across products**  
   Relevant products are evaluated against those requirements rather than simply ranked by popularity.

4. **Explain the trade-offs**  
   Discern explains why an option fits and where another option may be better.

5. **Make a decision**  
   The goal isn't to give you more products. It's to help you confidently choose one.

## Example

Instead of searching:

> "white sneakers"

You can ask:

> "I need white sneakers under $150 that are comfortable enough for walking every day, easy to style, and durable."

Discern can then evaluate the available options against those specific requirements and explain which products are the strongest matches.

## Why fashion?

Fashion is highly personal.

The right product depends on more than price or ratings. Factors such as style, fit, quality, materials, occasion, comfort, brand, and personal preferences can all change the answer.

That makes fashion a natural starting point for decision-making software.

## Vision

Discern is starting with fashion, but the broader goal is larger than shopping.

**Enuid Labs is building AI-native decision engines.**

Search helps people discover what's available. Decision engines help people understand their options and decide what's right for them.

## Tech Stack

- **Next.js**
- **React**
- **TypeScript**
- **Tailwind CSS**
- **Convex** — backend, database, authentication, and real-time infrastructure
- **Shopify Global Catalog** — product data
- **Open-weight AI models** — natural-language reasoning over product data
- **Cerebras / Groq / OpenRouter** — model inference
- **Claude Code** — development
- **Vercel** — deployment

## Project Status

Discern is currently in an early beta.

The first working version was built and shipped in one week and is being tested with early users. The product is actively evolving based on user feedback and real shopping decisions.

## Development

Clone the repository and install the dependencies:

```bash
git clone <repository-url>
cd discern
npm install
```

Create your local environment file:

```bash
cp .env.example .env.local
```

Add the required environment variables, then run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Contributing

Discern is currently an early-stage product under active development. Contributions, ideas, and feedback are welcome.

## License

License information will be added as the project develops.

---

**Discern — from search to decision.**
