
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

/**
 * ฟังก์ชันทำความสะอาดข้อความ JSON ที่อาจมี Markdown Backticks ปนมา
 */
const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
  // หา JSON block ด้วย Regex เพื่อความแม่นยำสูงสุด
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
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
  error?: string 
}> => {
  try {
    // สร้าง instance ใหม่ทุกครั้งเพื่อให้แน่ใจว่าได้ใช้ API Key ล่าสุด
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญด้าน OMR (Optical Mark Recognition) หน้าที่ของคุณคือวิเคราะห์ "กระดาษเฉลย" และส่งคืนคำตอบที่ถูกต้องในรูปแบบ JSON เท่านั้น`
      : `คุณคือผู้เชี่ยวชาญด้าน OMR และ OCR ภาษาไทย หน้าที่ของคุณคืออ่านเลขที่ ชื่อ และคำตอบของนักเรียนจากภาพถ่ายกระดาษคำตอบ และส่งคืนข้อมูลในรูปแบบ JSON เท่านั้น`;

    const userPrompt = isKey
      ? `วิเคราะห์ภาพกระดาษคำตอบนี้เพื่อหา "เฉลย" ข้อ 1 ถึง ${totalQuestions} โดยตัวเลือกที่ระบายคือ ก, ข, ค, หรือ ง`
      : `อ่านเลขที่ (Student ID), ชื่อ-นามสกุล และวิเคราะห์คำตอบข้อ 1 ถึง ${totalQuestions} จากกระดาษคำตอบนี้`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
            { text: userPrompt }
          ]
        }
      ],
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
    console.error("OMR Error Details:", err);
    
    let friendlyError = "ประมวลผลล้มเหลว กรุณาตรวจสอบความชัดเจนของภาพถ่าย หรือเลือกใช้ภาพที่ไม่มีเงาสะท้อน";
    
    // ตรวจสอบข้อผิดพลาดที่เกี่ยวกับ API Key หรือ Quota
    const errorMsg = err.message || "";
    if (errorMsg.includes("API_KEY") || errorMsg.includes("unauthorized") || errorMsg.includes("401") || errorMsg.includes("API key not found")) {
      friendlyError = "ผิดพลาด: ไม่พบ API Key หรือ Key ไม่ถูกต้อง กรุณากดปุ่ม 'เชื่อมต่อ API' เพื่อตั้งค่าใหม่";
    } else if (errorMsg.includes("429") || errorMsg.includes("quota")) {
      friendlyError = "ใช้งานเกินขีดจำกัด (Rate Limit) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง";
    } else if (errorMsg.includes("Safety")) {
      friendlyError = "ภาพถูกระงับโดยระบบความปลอดภัยของ AI กรุณาถ่ายภาพใหม่ให้ชัดเจนขึ้น";
    }

    return { answers: [], error: friendlyError };
  }
};
