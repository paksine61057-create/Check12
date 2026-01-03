
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

/**
 * ฟังก์ชันดึงเฉพาะ JSON object ออกจากข้อความ (ช่วยป้องกันกรณี AI แถมข้อความอื่นมา)
 */
const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
  // หาตำแหน่ง { ตัวแรก และ } ตัวสุดท้าย
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  
  if (start !== -1 && end !== -1 && end > start) {
    return text.substring(start, end + 1);
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
    // ตรวจสอบว่ามี API Key หรือไม่ก่อนเริ่ม
    if (!process.env.API_KEY) {
      return { answers: [], error: "ไม่พบ API Key ในระบบ กรุณาเชื่อมต่อ API", isAuthError: true };
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญด้าน OMR หน้าที่ของคุณคือวิเคราะห์ "กระดาษเฉลย" และส่งคืนคำตอบที่ถูกต้องในรูปแบบ JSON เท่านั้น`
      : `คุณคือผู้เชี่ยวชาญด้าน OMR และ OCR ภาษาไทย หน้าที่ของคุณคืออ่านเลขที่ ชื่อ และคำตอบของนักเรียนจากภาพถ่ายกระดาษคำตอบ และส่งคืนข้อมูลในรูปแบบ JSON เท่านั้น`;

    const userPrompt = isKey
      ? `วิเคราะห์ภาพกระดาษคำตอบนี้เพื่อหา "เฉลย" ข้อ 1 ถึง ${totalQuestions} โดยตัวเลือกที่ระบายคือ ก, ข, ค, หรือ ง`
      : `อ่านเลขที่ (Student ID), ชื่อ-นามสกุล และวิเคราะห์คำตอบข้อ 1 ถึง ${totalQuestions} จากกระดาษคำตอบนี้`;

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

    const rawText = response.text;
    if (!rawText) throw new Error("AI ไม่คืนค่าข้อมูล");
    
    const cleanedText = cleanJsonResponse(rawText);
    const data = JSON.parse(cleanedText);
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
    console.error("OMR API Error:", err);
    
    const errorMsg = err.message || "";
    let friendlyError = "ประมวลผลล้มเหลว กรุณาตรวจสอบความชัดเจนของภาพถ่าย";
    let isAuthError = false;

    // ตรวจสอบ Error ที่เกี่ยวกับสิทธิ์การใช้งาน
    if (
      errorMsg.includes("API_KEY") || 
      errorMsg.includes("unauthorized") || 
      errorMsg.includes("401") || 
      errorMsg.includes("not found") || 
      errorMsg.includes("Key")
    ) {
      friendlyError = "ผิดพลาด: ปัญหาเกี่ยวกับ API Key กรุณาเชื่อมต่อ API ใหม่";
      isAuthError = true;
    } else if (errorMsg.includes("429") || errorMsg.includes("quota")) {
      friendlyError = "ใช้งานเกินขีดจำกัด (Rate Limit) กรุณารอสักครู่แล้วลองใหม่";
    }

    return { answers: [], error: friendlyError, isAuthError };
  }
};
