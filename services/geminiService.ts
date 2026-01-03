
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

/**
 * ฟังก์ชันดึงเฉพาะ JSON object ออกจากข้อความให้แม่นยำที่สุด
 */
const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return text.substring(start, end + 1);
    }
  } catch (e) {
    console.error("JSON Clean Error:", e);
  }
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
  error?: string,
  isAuthError?: boolean
}> => {
  try {
    // เริ่มต้นใช้งาน AI ด้วย API Key จากสภาพแวดล้อม
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญด้าน OMR หน้าที่ของคุณคือวิเคราะห์ "กระดาษเฉลย" และส่งคืนคำตอบในรูปแบบ JSON { "questions": [...] }`
      : `คุณคือผู้เชี่ยวชาญด้าน OMR และ OCR ภาษาไทย หน้าที่ของคุณคืออ่านเลขที่ ชื่อ และคำตอบนักเรียน ส่งคืน JSON { "studentNumber": "...", "studentName": "...", "questions": [...] }`;

    const userPrompt = isKey
      ? `วิเคราะห์ภาพเฉลยข้อ 1 ถึง ${totalQuestions} โดยตัวเลือกคือ ก, ข, ค, หรือ ง`
      : `อ่านข้อมูลและวิเคราะห์คำตอบข้อ 1 ถึง ${totalQuestions} จากกระดาษคำตอบนี้`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: userPrompt }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
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
                  marked: { type: Type.STRING, nullable: true }
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

    if (!response.text) throw new Error("ไม่ได้รับการตอบสนองจาก AI");
    
    const data = JSON.parse(cleanJsonResponse(response.text));
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = q.id - 1;
        if (idx >= 0 && idx < totalQuestions) {
          const val = q.marked;
          if (['ก', 'ข', 'ค', 'ง', 'multiple'].includes(val)) {
            answers[idx] = val as Choice;
          } else {
            answers[idx] = null;
          }
        }
      });
    }

    return {
      answers,
      studentId: data.studentNumber || "",
      studentName: data.studentName || ""
    };
  } catch (err: any) {
    console.error("OMR Service Error:", err);
    
    const msg = err.message || "";
    let friendlyError = "ประมวลผลภาพล้มเหลว กรุณาตรวจสอบความชัดเจนของภาพ";
    let isAuthError = false;

    if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("API_KEY") || msg.includes("not found")) {
      friendlyError = "API Key ไม่ถูกต้องหรือหมดอายุ";
      isAuthError = true;
    } else if (msg.includes("429")) {
      friendlyError = "เรียกใช้งานถี่เกินไป กรุณารอสักครู่";
    }

    return { answers: [], error: friendlyError, isAuthError };
  }
};
