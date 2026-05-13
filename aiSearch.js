const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getSearchTerms(query) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `أنت مساعد صيدلاني مصري. المستخدم كتب: "${query}"
    
مهمتك: حول هذا الاستعلام لأسماء أدوية إنجليزية يمكن البحث عنها في قاعدة بيانات الأدوية المصرية.

القواعد:
- لو كتب اسم مرض أو أعراض بالعربي (مثل: برد، صداع، حمى) → اعطه أشهر 5 أدوية علاجية
- لو كتب اسم دواء عربي → حوله لاسمه الإنجليزي
- لو كتب اسم إنجليزي → اعطه كما هو
- الرد يكون JSON فقط بدون أي نص إضافي

مثال: برد → {"terms": ["paracetamol", "ibuprofen", "amoxicillin", "cetirizine", "pseudoephedrine"], "message": "أدوية البرد الشائعة"}
مثال: صداع → {"terms": ["paracetamol", "ibuprofen", "aspirin"], "message": "أدوية الصداع"}
مثال: باراسيتامول → {"terms": ["paracetamol"], "message": ""}
مثال: paracetamol → {"terms": ["paracetamol"], "message": ""}

الاستعلام: "${query}"
الرد (JSON فقط):`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    // نظف الـ response
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed;
    
  } catch (err) {
    console.error('Gemini error:', err.message);
    // fallback: ابعت الكلمة كما هي
    return { terms: [query], message: '' };
  }
}

module.exports = { getSearchTerms };