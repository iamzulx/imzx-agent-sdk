# 💡 imzx Usage Ideas (Use Cases)

Not sure what kind of assistant to create? Here are some ideas for assistants you can build with imzx to help with your daily life or work.

---

## 👩‍🏫 1. Learning Assistant (Personal Tutor)
**Purpose**: Help you learn difficult topics (such as Physics, English, or Coding) with easy-to-understand explanations.

**How to create the Persona (`learning.json`):**
```json
{
  "description": "Learning Tutor",
  "prompt": "You are an expert learning tutor. Use the Feynman Technique: explain complex concepts as if I were a 10-year-old. Provide real-world examples and ask a question at the end to test my understanding."
}
```
**Example Usage:**
`./venv/bin/python main.py "Explain how a Black Hole works" learning`

---

## ✍️ 2. Writing Editor & Language Corrector
**Purpose**: Turn rough drafts into professional emails, engaging blog posts, or fix grammatical errors.

**How to create the Persona (`editor.json`):**
```json
{
  "description": "Professional Editor",
  "prompt": "You are a senior language editor. Your task is to fix grammar, improve word choice to make it more elegant, and ensure the tone matches the target audience (Formal/Casual)."
}
```
**Example Usage:**
`./venv/bin/python main.py "Please turn this WhatsApp message into a formal email to my boss: 'Boss, I'll be late tomorrow because of a flat tire'" editor`

---

## 🛡️ 3. Security & Privacy Consultant
**Purpose**: Check if a document or text contains sensitive information that should not be shared.

**How to create the Persona (`security.json`):**
```json
{
  "description": "Privacy Expert",
  "prompt": "You are a data privacy expert. Analyze the given text and let me know if there is any sensitive data such as email addresses, phone numbers, or passwords that were accidentally included."
}
```
**Example Usage:**
`./venv/bin/python main.py "Here is the announcement draft: Contact me at 08123456789 or secret@mail.com" security`

---

## 💰 4. Smart Budget Management (Cost Efficient)
**Purpose**: Use the **LLM Routing** feature to get high-quality answers while spending the minimum amount of money.

**How it works:**
You don't need to create a special persona; simply set the `price_weight` in the main engine (Rust core) to a high value (e.g., 0.8).

**When to use this?**
- When you want to analyze very long documents (hundreds of pages).
- When you want to perform large-scale research that doesn't require an instant response.
- **Result**: You get answers from the most cost-effective AI model, making your API Key balance last longer!
