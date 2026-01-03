
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

/**
 * ฟังก์ชันทำความสะอาดข้อความ JSON ที่อาจมี Markdown Backticks ปนมา
 */
const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
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
    // สร้าง instance ใหม่ทุกครั้งเพื่อให้แน่ใจว่าได้ใช้ API Key ล่าสุด
    // ใช้ process.env.API_KEY โดยตรงตามข้อกำหนด
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const prompt = isKey 
      ? `คุณคือผู้เชี่ยวชาญด้านการตรวจกระดาษคำตอบ (OMR) 
         วิเคราะห์ภาพ "เฉลยต้นแบบ" นี้
         ตรวจสอบตำแหน่งที่ระบายสีดำหรือกากบาทในข้อ 1 ถึง ${totalQuestions}
         ส่งคืนข้อมูลในรูปแบบ JSON เท่านั้น โดยมีโครงสร้าง: 
         { "questions": [ { "id": 1, "marked": "ก" }, ... ] }
         ตัวเลือกที่อนุญาตคือ ก, ข, ค, ง`
      : `คุณคือผู้เชี่ยวชาญด้าน OMR และการอ่านภาษาไทย (OCR)
         1. อ่านเลขที่ (Student ID) และ ชื่อ-นามสกุล จากหัวกระดาษ
         2. วิเคราะห์คำตอบข้อ 1 ถึง ${totalQuestions}
         ส่งคืน JSON: 
         { "studentNumber": "...", "studentName": "...", "questions": [ { "id": 1, "marked": "ก" }, ... ] }
         ถ้าไม่ระบายให้ใช้ null, ถ้าระบายหลายช่องให้ใช้ "multiple"`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: prompt }
        ]
      },
      config: {
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
    
    const data = JSON.parse(cleanJsonResponse(rawText));
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
    console.error("OMR Error:", err);
    
    let friendlyError = "ประมวลผลล้มเหลว กรุณาตรวจสอบความชัดเจนของภาพถ่ายหรือแสงสว่าง";
    
    if (err.message?.includes("API_KEY") || err.message?.includes("unauthorized") || err.message?.includes("401")) {
      friendlyError = "API Key ไม่ถูกต้องหรือยังไม่ได้ตั้งค่า กรุณาเชื่อมต่อ API ใหม่อีกครั้ง";
    } else if (err.message?.includes("429")) {
      friendlyError = "มีการเรียกใช้งานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง";
    }

    return { answers: [], error: friendlyError };
  }
};
