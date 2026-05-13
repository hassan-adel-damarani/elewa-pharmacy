const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getSearchTerms(query) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `أنت مساعد صيدلاني مصري. المستخدم كتب: "${query}"
مهمتك: حول هذا الاستعلام لأسماء أدوية إنجليزية + ترجمتها للعربي + وصف بسيط.
القواعد:
- لو كتب أعراض بالعربي (برد، صداع، حمى) → اعطه أشهر 5 أدوية
- لكل دواء: الاسم الإنجليزي، الاسم العربي، وصف بسيط، الأعراض
- الرد JSON فقط بدون أي نص إضافي

مثال "برد":
{"terms":["paracetamol","ibuprofen","cetirizine","pseudoephedrine","amoxicillin"],"message":"أدوية البرد الشائعة","drugs":[{"en":"paracetamol","ar":"باراسيتامول","desc":"مسكن للألم وخافض للحرارة","symptoms":["حمى","صداع"]},{"en":"ibuprofen","ar":"بروفين","desc":"مضاد للالتهابات ومسكن","symptoms":["حمى","آلام"]},{"en":"cetirizine","ar":"سيتريزين","desc":"مضاد للحساسية","symptoms":["عطس","رشح"]},{"en":"pseudoephedrine","ar":"سودوإيفيدرين","desc":"مفتح للأنف","symptoms":["احتقان"]},{"en":"amoxicillin","ar":"أموكسيسيلين","desc":"مضاد حيوي","symptoms":["عدوى بكتيرية"]}]}

الاستعلام: "${query}"
الرد (JSON فقط):`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
    
  } catch (err) {
    console.error('Gemini error:', err.message);
    return { terms: [query], message: '', drugs: [] };
  }
}

module.exports = { getSearchTerms };