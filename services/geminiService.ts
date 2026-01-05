
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
    // ดึง API Key อย่างปลอดภัยที่สุด
    let apiKey = "";
    try {
      apiKey = (process.env.API_KEY || (window as any).API_KEY || "").toString().trim();
    } catch (e) {
      apiKey = ((window as any).API_KEY || "").toString().trim();
    }

    // ล้างเครื่องหมายคำพูดที่อาจแถมมา
    apiKey = apiKey.replace(/^['"]|['"]$/g, ''); 

    if (!apiKey || apiKey === "undefined" || apiKey === "null") {
      return { 
        answers: [], 
        error: "ไม่พบรหัส API_KEY กรุณากดปุ่ม 'เชื่อมต่อ API Key' หรือตรวจสอบการตั้งค่าใน Vercel", 
        isAuthError: true 
      };
    }

    // สร้าง Instance ใหม่ทุกครั้งที่เรียกเพื่อใช้ Key ล่าสุด
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
    // หากเกิด Error "Entity not found" ให้รีเซ็ตสถานะเพื่อให้ผู้ใช้เลือก Key ใหม่
    if (errMsg.includes("not found") || errMsg.includes("401") || errMsg.includes("api_key") || errMsg.includes("invalid")) {
      friendlyError = "API Key ไม่ถูกต้อง หรือโครงการไม่ได้เปิดใช้งาน API นี้";
      isAuthError = true;
    }

    return { answers: [], error: friendlyError, isAuthError };
  }
};
