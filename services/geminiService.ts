
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
    // พยายามดึง Key จากช่องทางต่างๆ (Environment หรือ Global)
    const apiKey = process.env.API_KEY || (window as any).API_KEY;

    if (!apiKey || apiKey === "undefined" || apiKey === "null" || apiKey.trim() === "") {
      return { answers: [], error: "ยังไม่ได้ตั้งค่า API_KEY ในระบบ (Environment Variable)", isAuthError: true };
    }

    // ตรวจสอบว่ายังเป็น Project ID เก่าหรือไม่
    if (apiKey.startsWith("gen-lang-client")) {
      return { 
        answers: [], 
        error: "พบ Project ID แทนที่จะเป็น API Key กรุณาใช้รหัสที่ขึ้นต้นด้วย 'AIza...'", 
        isAuthError: true 
      };
    }

    // ตรวจสอบความยาวเบื้องต้น (ปกติ API Key ของ Google จะยาวประมาณ 39-40 ตัวอักษร)
    if (apiKey.length < 30) {
      return {
        answers: [],
        error: "รูปแบบ API Key ไม่ถูกต้อง (สั้นเกินไป) กรุณาตรวจสอบรหัส 'AIza...' อีกครั้ง",
        isAuthError: true
      };
    }

    // สร้าง Instance ใหม่ทุกครั้งตามกฎเพื่อความสดใหม่ของ Key
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญด้าน OMR หน้าที่ของคุณคือวิเคราะห์ "กระดาษเฉลย" และส่งคืนคำตอบในรูปแบบ JSON { "questions": [...] } โดยใช้ตัวเลือก ก, ข, ค, ง`
      : `คุณคือผู้เชี่ยวชาญด้าน OMR และ OCR ภาษาไทย อ่านเลขที่ ชื่อ และคำตอบนักเรียน ส่งคืน JSON { "studentNumber": "...", "studentName": "...", "questions": [...] }`;

    const userPrompt = isKey
      ? `วิเคราะห์ภาพเฉลยข้อ 1 ถึง ${totalQuestions}`
      : `อ่านและตรวจแผ่นคำตอบข้อ 1 ถึง ${totalQuestions}`;

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
    let friendlyError = "AI ประมวลผลภาพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    let isAuthError = false;

    // ตรวจสอบข้อผิดพลาดเฉพาะเจาะจงจาก Google API
    const errMsg = err.message?.toLowerCase() || "";
    if (errMsg.includes("401") || errMsg.includes("api_key") || errMsg.includes("invalid") || errMsg.includes("not found")) {
      friendlyError = "API Key ไม่ถูกต้อง หรือโปรเจกต์ไม่ได้เปิดใช้งาน API นี้ (โปรดเช็คใน AI Studio)";
      isAuthError = true;
    }

    return { answers: [], error: friendlyError, isAuthError };
  }
};
