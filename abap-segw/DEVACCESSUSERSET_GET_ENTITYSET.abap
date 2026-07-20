METHOD devaccessuserset_get_entityset.
  DATA: lt_roles  TYPE TABLE OF agr_1251-agr_name,
        ls_entity TYPE zcl_zuser_lock_srv_mpc=>ts_devaccessuser.

  SELECT agr_name, auth, field, low, high
    FROM agr_1251
    INTO TABLE @DATA(lt_auth)
    WHERE object = 'S_DEVELOP'
      AND field  = 'ACTVT'
      AND ( low = '01' OR low = '02' OR high = '01' OR high = '02' ).

  IF lt_auth IS NOT INITIAL.
    lt_roles = VALUE #( FOR ls_auth IN lt_auth ( ls_auth-agr_name ) ).
    SORT lt_roles.
    DELETE ADJACENT DUPLICATES FROM lt_roles.

    SELECT uname, agr_name
      FROM agr_users
      INTO TABLE @DATA(lt_users)
      FOR ALL ENTRIES IN @lt_roles
      WHERE agr_name = @lt_roles-table_line
        AND to_dat >= @sy-datum.

    LOOP AT lt_users INTO DATA(ls_user).
      CLEAR ls_entity.
      ls_entity-username   = ls_user-uname.
      ls_entity-rolename   = ls_user-agr_name.
      ls_entity-authobject = 'S_DEVELOP'.

      READ TABLE lt_auth INTO DATA(ls_match)
        WITH KEY agr_name = ls_user-agr_name.
      IF sy-subrc = 0.
        ls_entity-activity = ls_match-low.
      ENDIF.

      APPEND ls_entity TO et_entityset.
    ENDLOOP.

    SORT et_entityset BY username.
    DELETE ADJACENT DUPLICATES FROM et_entityset COMPARING username rolename.
  ENDIF.
ENDMETHOD.
