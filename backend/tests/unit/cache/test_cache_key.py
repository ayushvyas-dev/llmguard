"""Unit tests for canonical cache key construction (CACHE-002, CACHE-003)."""

from uuid import uuid4

from app.cache.key import build_cache_key
from app.schemas.chat import ChatMessage, ToolDefinition, ToolFunction


def test_cache_key_prefix_and_stability():
    client_id = uuid4()
    messages = [ChatMessage(role="user", content="Hello world")]
    params = {"temperature": 0.0, "top_p": 1.0, "max_tokens": 100, "stop": None, "seed": None}

    k1 = build_cache_key(
        client_id=client_id,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=messages,
        generation_params=params,
    )
    k2 = build_cache_key(
        client_id=client_id,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=messages,
        generation_params=params,
    )

    assert k1.startswith("llmguard:cache:v1:")
    assert len(k1) == len("llmguard:cache:v1:") + 64
    assert k1 == k2


def test_changing_any_key_component_changes_the_key():
    client_a = uuid4()
    client_b = uuid4()
    base_messages = [
        ChatMessage(role="system", content="You are a helpful assistant."),
        ChatMessage(role="user", content="Translate this to French: Good morning"),
    ]
    base_params = {"temperature": 0.0, "top_p": 1.0, "max_tokens": 100, "stop": None, "seed": 42}

    base_key = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=base_messages,
        generation_params=base_params,
    )

    # 1. Changing client_id
    key_client_b = build_cache_key(
        client_id=client_b,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=base_messages,
        generation_params=base_params,
    )
    assert key_client_b != base_key

    # 2. Changing provider
    key_provider = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=1,
        provider="groq",
        provider_model="fake-chat",
        messages=base_messages,
        generation_params=base_params,
    )
    assert key_provider != base_key

    # 3. Changing provider_model
    key_model = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat-large",
        messages=base_messages,
        generation_params=base_params,
    )
    assert key_model != base_key

    # 4. Changing temperature
    key_temp = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=base_messages,
        generation_params={**base_params, "temperature": 0.7},
    )
    assert key_temp != base_key

    # 5. Changing top_p
    key_top_p = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=base_messages,
        generation_params={**base_params, "top_p": 0.9},
    )
    assert key_top_p != base_key

    # 6. Changing system prompt
    key_sys = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=[
            ChatMessage(role="system", content="You are a sarcastic assistant."),
            base_messages[1],
        ],
        generation_params=base_params,
    )
    assert key_sys != base_key

    # 7. Changing user prompt
    key_user = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=[
            base_messages[0],
            ChatMessage(role="user", content="Translate this to German: Good morning"),
        ],
        generation_params=base_params,
    )
    assert key_user != base_key

    # 8. Changing policy_version
    key_policy = build_cache_key(
        client_id=client_a,
        policy_version=2,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=base_messages,
        generation_params=base_params,
    )
    assert key_policy != base_key

    # 9. Changing routing_version
    key_routing = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=2,
        provider="fake",
        provider_model="fake-chat",
        messages=base_messages,
        generation_params=base_params,
    )
    assert key_routing != base_key

    # 10. Adding / changing tools
    tool = ToolDefinition(
        type="function",
        function=ToolFunction(name="weather", description="Get weather", parameters={}),
    )
    key_tools = build_cache_key(
        client_id=client_a,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=base_messages,
        generation_params=base_params,
        tools=[tool],
    )
    assert key_tools != base_key


def test_text_normalization_equivalence():
    client_id = uuid4()
    params = {"temperature": 0.0}

    # Text with zero-width spaces vs clean text
    msg_with_zero_width = [ChatMessage(role="user", content="Hello\u200b \u200cworld")]
    msg_clean = [ChatMessage(role="user", content="Hello world")]

    k1 = build_cache_key(
        client_id=client_id,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=msg_with_zero_width,
        generation_params=params,
    )
    k2 = build_cache_key(
        client_id=client_id,
        policy_version=1,
        routing_version=1,
        provider="fake",
        provider_model="fake-chat",
        messages=msg_clean,
        generation_params=params,
    )

    assert k1 == k2
