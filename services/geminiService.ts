
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

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
    // การดึงค่า API_KEY ที่รองรับทั้งการแทนที่ที่ Build-time และ Runtime
    let apiKey = "";
    
    // พยายามดึงจากหลายช่องทางที่ Vercel อาจจะส่งมา
    const envKey = process?.env?.API_KEY;
    const windowKey = (window as any).API_KEY;
    
    apiKey = (envKey || windowKey || "").toString().trim();

    // ทำความสะอาดรหัส
    apiKey = apiKey.replace(/^['"]|['"]$/g, ''); 

    if (!apiKey || apiKey === "undefined") {
      return { 
        answers: [], 
        error: "แอปไม่ได้รับรหัส API_KEY จากระบบ Vercel กรุณากด 'Redeploy' ในหน้า Dashboard ของ Vercel", 
        isAuthError: true 
      };
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญด้าน OMR หน้าที่ของคุณคือวิเคราะห์ "กระดาษเฉลย" และส่งคืนคำตอบในรูปแบบ JSON { "questions": [...] } โดยใช้ตัวเลือก ก, ข, ค, ง`
      : `คุณคือผู้เชี่ยวชาญด้าน OMR และ OCR ภาษาไทย อ่านเลขที่ ชื่อ และคำตอบนักเรียน ส่งคืน JSON { "studentNumber": "...", "studentName": "...", "questions": [...] }`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: isKey ? `วิเคราะห์ภาพเฉลย 1-${totalQuestions}` : `ตรวจแผ่นคำตอบ 1-${totalQuestions}` }
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

    if (!response.text) throw new Error("AI ไม่ตอบสนอง");
    
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
    let friendlyError = "เกิดข้อผิดพลาดในการประมวลผล";
    let isAuthError = false;

    const errMsg = err.message?.toLowerCase() || "";
    if (errMsg.includes("401") || errMsg.includes("api_key") || errMsg.includes("invalid")) {
      friendlyError = "API Key ไม่ถูกต้อง (Unauthorized) กรุณาตรวจสอบรหัส 'AIza...' อีกครั้ง";
      isAuthError = true;
    }

    return { answers: [], error: friendlyError, isAuthError };
  }
};
