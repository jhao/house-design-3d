"""API 输入/输出模型（Pydantic）。"""
from pydantic import BaseModel, Field
from typing import Optional, Any


class ProjectCreate(BaseModel):
    name: str = "未命名房型"
    scene: Optional[dict] = None


class ProjectUpdate(BaseModel):
    scene: dict


class ProjectRename(BaseModel):
    name: str


class ScaleRequest(BaseModel):
    ratio: float = Field(..., gt=0, description="缩放比例，例如 1.1 表示放大 10%")


class AiArrangeRequest(BaseModel):
    message: str


class ApplyActionsRequest(BaseModel):
    """标准动作 API 请求：一组画布动作（详见 backend/app/actions.py）。

    每个动作形如 {"op": "add_furniture", "type": "sofa", "x": 3000, "y": 2000}。
    """
    actions: list
    message: Optional[str] = None


class ImportResponse(BaseModel):
    id: int
    name: str
    scene: dict


class LlmSettings(BaseModel):
    """大模型（含多模态）配置，字段可部分更新。"""
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    vision_model: Optional[str] = None
    enabled: Optional[bool] = None
    dwg_converter: Optional[str] = None
    timeout: Optional[float] = None
    max_tokens: Optional[int] = None
    recognition_prompt: Optional[str] = None


class FurnitureDefaultsPayload(BaseModel):
    """家具默认值覆盖：{type: {label,width,depth,height,color}}"""
    defaults: Any
