
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

/**
 * ฟังก์ชันทำความสะอาดข้อความ JSON ที่อาจมี Markdown Backticks ปนมา
 */
const cleanJsonResponse = (text: string): string => {
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

export const analyzeAnswerSheet = async (
  base64Image: string,
  totalQuestions: number,
  isKey: boolean = false
): Promise<{ 
  answers: Choice[], 
  studentId?: string, 
  studentName?: string,
  error?: string 
}> => {
  try {
    // ตรวจสอบ API Key เบื้องต้น
    if (!process.env.API_KEY) {
      return { answers: [], error: "กรุณาตรวจสอบการตั้งค่า API_KEY ในระบบ" };
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // ปรับปรุง Prompt ให้เข้าใจบริบท OMR ได้ดีขึ้นและขอคำตอบที่แน่นอน
    const prompt = isKey 
      ? `You are an expert OMR Scanner. 
         Analyze the provided Answer Key image. 
         Identify the marked choices for exactly ${totalQuestions} questions. 
         Possible marks are: ก, ข, ค, ง.
         Return ONLY a valid JSON object with a 'questions' array containing {id: number, marked: string}.`
      : `You are an expert OMR and Thai OCR Scanner. 
         1. Identify Student ID (numeric) and Thai/English Name from the header.
         2. Extract marked answers for exactly ${totalQuestions} questions. 
         Choices: ก, ข, ค, ง, null (if empty), multiple (if >1 marked).
         Return results as a clean JSON object.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: prompt }
        ]
      },
      config: {
        // ปรับจูน Parameter เพื่อความแม่นยำสูง
        temperature: 0.1, 
        topP: 0.8,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  marked: { type: Type.STRING }
                },
                required: ["id", "marked"]
              }
            },
            studentNumber: { type: Type.STRING },
            studentName: { type: Type.STRING }
          },
          required: ["questions"]
        }
      }
    });

    const rawText = response.text;
    if (!rawText) throw new Error("AI returned empty text");
    
    // ทำความสะอาดและ Parse JSON
    const data = JSON.parse(cleanJsonResponse(rawText));
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = q.id - 1;
        if (idx >= 0 && idx < totalQuestions) {
          const val = q.marked;
          // ตรวจสอบค่าที่อนุญาต
          if (['ก', 'ข', 'ค', 'ง', 'multiple'].includes(val)) {
            answers[idx] = val as Choice;
          } else if (val === 'null' || val === null || val === '') {
            answers[idx] = null;
          }
        }
      });
    } else {
      throw new Error("Invalid JSON structure: missing questions array");
    }

    return {
      answers,
      studentId: data.studentNumber?.trim(),
      studentName: data.studentName?.trim()
    };
  } catch (err: any) {
    console.error("Gemini OMR OCR Error Details:", err);
    
    // แยกแยะข้อผิดพลาดเพื่อให้ครูแก้ไขเบื้องต้นได้
    let friendlyError = "การประมวลผลล้มเหลว กรุณาตรวจสอบคุณภาพของภาพถ่าย";
    
    if (err.message?.includes("429")) {
      friendlyError = "ระบบทำงานหนักเกินไป (Rate Limit) กรุณารอสักครู่แล้วลองใหม่";
    } else if (err.message?.includes("API key")) {
      friendlyError = "API Key ไม่ถูกต้องหรือหมดอายุ";
    } else if (err.message?.includes("Safety")) {
      friendlyError = "ภาพถูกระงับเนื่องจากนโยบายความปลอดภัย กรุณาถ่ายใหม่ให้ชัดเจน";
    }

    return { answers: [], error: friendlyError };
  }
};
